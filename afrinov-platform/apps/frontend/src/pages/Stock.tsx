import { useState } from 'react';
import { StockStatusBadge } from '../components/StockStatusBadge';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { FilterBar, SearchField, FILTER_WIDTH } from '../components/FilterBar';
import { Button } from '../components/Button';
import { Field, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { RoleGuard } from '../components/RoleGuard';
import { usePermissions } from '../hooks/usePermissions';
import { formatNumber } from '../lib/format';
import { StockActionForm, type StockActionKind } from '../components/StockActionForm';
import { STORES_CATEGORIES, categoryLabel, sectionOf } from '../lib/categories';
import type { CurrentStockRow } from '../api/types';
import { ProjectStockNotice } from '../components/LeftoversNotice';
import { locationLabel, type NamedLocation } from '../lib/locations';
import { StaleDataNotice } from '../components/StaleDataNotice';


const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'OK', label: 'OK' },
  { value: 'NOT_SET', label: 'No Required Stock' },
  { value: 'out', label: 'None at this location' },
];

export function Stock() {
  const stock = useApi<CurrentStockRow[]>('/reports/current-stock');
  // Which room each location stands in: for the Room filter and the Location column.
  const locations = useApi<Array<{ id: string; parentId?: string | null } & NamedLocation>>('/locations');
  // Other pages link here with ?q=, ?category= or ?status= (an item's page sends
  // its SKU). Stock is the store's: Stores items only. Project material goes from
  // the supplier straight to site, so it is never stock on hand; any still in the
  // store from before is listed by project above the table (Stores and
  // Procurement Separation Roadmap). An older ?section=PROJECTS link lands here too.
  const [params, setParams] = useSearchParams();
  // The address follows the filters, so a reload or a shared link shows what is on screen.
  const writeParams = (change: Record<string, string>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [key, value] of Object.entries(change)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    return next;
  }, { replace: true });
  const changeQ = (value: string) => { setQ(value); writeParams({ q: value }); };
  const changeCategory = (value: string) => { setCategory(value); writeParams({ category: value }); };
  const changeStatus = (value: string) => { setStatus(value); writeParams({ status: value }); };
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [category, setCategory] = useState(() => (STORES_CATEGORIES.some((c) => c.value === params.get('category')) ? params.get('category')! : ''));
  const [status, setStatus] = useState(() => (STATUS_OPTIONS.some((o) => o.value === params.get('status')) ? params.get('status')! : ''));
  const [action, setAction] = useState<{ kind: StockActionKind; row: CurrentStockRow } | null>(null);
  const { hasPermission } = usePermissions();
  const toast = useToast();

  // Rooms with locations inside them; a room's stock includes its racks'.
  const byId = new Map((locations.data ?? []).map((l) => [l.id, l]));
  const rooms = (locations.data ?? []).filter((l) => (locations.data ?? []).some((x) => x.parentId === l.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  // A room from a link stays in force, even one that no longer holds racks: while the
  // locations load the table waits, and if they fail it says so rather than show everything.
  const room = params.get('room') ?? '';
  const roomPending = !!room && !locations.data && !locations.error;
  const inRoom = (locationId: string) => locationId === room || byId.get(locationId)?.parentId === room;
  const placeOf = (r: CurrentStockRow) => { const l = byId.get(r.locationId); return l ? locationLabel(l) : r.locationName; };

  const stores = (stock.data ?? []).filter((r) => sectionOf(r.category) === 'STORES');
  const needle = q.trim().toLowerCase();
  const filtered = stores.filter((r) => {
    if (room && !inRoom(r.locationId)) return false;
    if (category && r.category !== category) return false;
    const qty = Number(r.quantity);
    if (status === 'out' && qty > 0) return false;
    if (status && status !== 'out' && r.stockStatus !== status) return false;
    if (needle) {
      const hay = `${r.materialSku} ${r.materialName} ${placeOf(r)}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const activeFilters = (category ? 1 : 0) + (status ? 1 : 0) + (q ? 1 : 0) + (room ? 1 : 0);

  return (
    <div>
      <PageHeader
        title="Stock"
        description="The store's current on-hand quantities across all locations. Source of truth is the inventory transaction ledger. Project material goes straight to site, so it is not stock."
        // Receive, Issue, Return and Count are in the Store menu. On a phone the
        // menu folds into a drawer (below md), so the most frequent action stays
        // one tap away here.
        actions={
          <RoleGuard permission="inventory:issue">
            <Link to="/stock/issue" className="md:hidden">
              <Button variant="primary" size="sm" leadingIcon={<Icon.ArrowRight size={14} />}>Issue stock</Button>
            </Link>
          </RoleGuard>
        }
      />

      <ProjectStockNotice rows={stock.data ?? []} className="mb-4" />

      <FilterBar
        onClear={activeFilters > 0 ? () => { setQ(''); setCategory(''); setStatus(''); writeParams({ q: '', category: '', status: '', room: '' }); } : undefined}
        count={stock.loading || roomPending ? 'Loading…' : `${filtered.length} of ${stores.length} lines`}
      >
        <SearchField id="stock-search" value={q} onChange={changeQ} placeholder="SKU, material or location…" />
        {(rooms.length > 0 || room) && (
          <Field label="Room" htmlFor="stock-room" className={FILTER_WIDTH}>
            <Select id="stock-room" value={room} onChange={(e) => writeParams({ room: e.target.value })}>
              <option value="">All rooms</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} and its racks</option>)}
              {/* A linked room holding no racks, or not found: keep it shown, so it can be cleared. */}
              {room && !rooms.some((r) => r.id === room) && <option value={room}>{byId.get(room)?.name ?? (locations.data ? 'Unknown room' : 'Loading…')}</option>}
            </Select>
          </Field>
        )}
        <Field label="Category" htmlFor="stock-category" className={FILTER_WIDTH}>
          <Select id="stock-category" value={category} onChange={(e) => changeCategory(e.target.value)}>
            <option value="">All categories</option>
            {STORES_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Status" htmlFor="stock-status" className={FILTER_WIDTH}>
          <Select id="stock-status" value={status} onChange={(e) => changeStatus(e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      </FilterBar>

      {stock.error && !stock.stale && <ErrorState error={stock.error} onRetry={stock.reload} />}
      {stock.stale && <StaleDataNotice error={stock.error} onRetry={stock.reload} />}
      {!stock.error && locations.error && !locations.stale && <ErrorState title="Rooms could not be loaded" error={locations.error} onRetry={locations.reload} />}
      {!stock.error && locations.stale && <StaleDataNotice error={locations.error} onRetry={locations.reload} label="Rooms could not be refreshed" />}

      {(!stock.error || stock.stale) && !(room && locations.error && !locations.stale) && (
        <DataTable<CurrentStockRow>
          ariaLabel="Stock lines"
          isLoading={stock.loading || roomPending}
          rowKey={(r) => `${r.materialId}-${r.locationId}`}
          rows={filtered}
          columns={columns({ placeOf, onAction: (kind, row) => setAction({ kind, row }), canTransfer: hasPermission('inventory:transfer'), canAdjust: hasPermission('inventory:adjust') })}
          emptyState={(
            <EmptyState
              title={activeFilters ? 'No stock matches your filters' : 'No stock yet'}
              description={activeFilters ? 'Try clearing your filters or searching for a different term.' : 'Stock will appear here once you record your first receipt.'}
            />
          )}
        />
      )}

      {action && (
        <Drawer
          open
          onClose={() => setAction(null)}
          title={actionTitle(action.kind, action.row)}
          description={action.row.materialName + ' · ' + action.row.locationName}
          width="md"
        >
          <StockActionForm
            kind={action.kind}
            row={action.row}
            onDone={() => { setAction(null); stock.reload(); }}
            onError={(err) => toast.error(`${actionTitle(action.kind, action.row)} failed`, err.message)}
            onSuccess={(msg) => toast.success(msg)}
          />
        </Drawer>
      )}

    </div>
  );
}

function actionTitle(kind: StockActionKind, row: CurrentStockRow): string {
  return {
    transfer: `Transfer ${row.materialSku}`,
    adjust: `Adjust ${row.materialSku}`,
  }[kind];
}

function columns({ placeOf, onAction, canTransfer, canAdjust }: {
  /** Where a row's stock is: a rack with its room, "D-1 · Main Storeroom". */
  placeOf: (r: CurrentStockRow) => string;
  onAction: (kind: StockActionKind, row: CurrentStockRow) => void;
  canTransfer: boolean;
  canAdjust: boolean;
}): DataTableColumn<CurrentStockRow>[] {
  return [
    { key: 'sku', header: 'SKU', render: (r) => <Link to={`/materials/${r.materialId}`} className="btn-link text-mono">{r.materialSku}</Link>, width: '8rem' },
    { key: 'name', header: 'Material', render: (r) => <span className="line-clamp-1" title={r.materialName}>{r.materialName}</span> },
    { key: 'cat', header: 'Category', render: (r) => <span className="text-meta">{categoryLabel(r.category)}</span>, width: '12rem' },
    { key: 'loc', header: 'Location', render: (r) => placeOf(r), width: '10rem' },
    { key: 'qty', header: 'On hand', align: 'right', className: 'text-num', render: (r) => <span className="font-mono font-medium">{formatNumber(Number(r.quantity))}</span>, width: '8rem' },
    { key: 'uom', header: 'UoM', render: (r) => r.unitOfMeasure, width: '6rem' },
    { key: 'reorder', header: 'Required', align: 'right', className: 'text-num', render: (r) => <span className="font-mono text-surface-500">{formatNumber(Number(r.requiredStock))}</span>, width: '8rem' },
    { key: 'status', header: 'Status', render: (r) => statusBadge(r), width: '10rem' },
    // Each button only for those the server lets do it; no column for those who can do neither.
    ...(canTransfer || canAdjust ? [{
      key: 'actions', header: '', align: 'right' as const, width: '11rem',
      render: (r: CurrentStockRow) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canTransfer && <Button size="sm" variant="secondary" onClick={() => onAction('transfer', r)}>Transfer</Button>}
          {canAdjust && <Button size="sm" variant="ghost" onClick={() => onAction('adjust', r)}>Adjust</Button>}
        </div>
      ),
    }] : []),
  ];
}

/** The item's status (its total across locations), the same on each of its rows. */
function statusBadge(r: CurrentStockRow) {
  return <StockStatusBadge status={r.stockStatus} percent={r.percentOfRequired} />;
}
