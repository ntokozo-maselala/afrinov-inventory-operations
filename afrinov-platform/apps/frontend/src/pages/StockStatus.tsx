// Stock status: every item's stock on hand (all locations) against its
// Required Stock, graded URGENT / WARNING / OK as the stock workbook's
// URGENCY column does, with the re-order quantity. GET /reports/stock-status.
// The bands are settings (Settings → Inventory).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PROCUREMENT_ENABLED } from '../config/features';
import { useApi } from '../hooks/useApi';
import { useStatusBands } from '../hooks/useStatusBands';
import { useIsAdmin } from '../hooks/usePermissions';
import { PageHeader } from '../components/PageHeader';
import { FilterBar, SearchField, FILTER_WIDTH } from '../components/FilterBar';
import { Field, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Alert } from '../components/Alert';
import { Icon } from '../components/Icon';
import { RoleGuard } from '../components/RoleGuard';
import { StockStatusBadge } from '../components/StockStatusBadge';
import { formatNumber } from '../lib/format';
import { needsAttention, type StockStatus as Status } from '../lib/stockStatus';
import { DownloadMenu } from '../components/DownloadMenu';
import { downloadReorderList, downloadReorderListPdf } from '../api/exportReorderList';
import { CATEGORIES } from '../lib/categories';

/** One item, as GET /reports/stock-status returns it. */
export interface StockStatusItem {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  requiredStock: string;
  onHand: string;
  /** Tools: out on loan, still owned; the status counts it with what is on hand. */
  onLoan?: string;
  percentOfRequired: number | null;
  status: Status;
  reorderQuantity: string;
  unitCost: string | null;
  locations: Array<{ locationId: string; locationName: string; quantity: string }>;
  /** The supplier of the latest posted goods receipt with this item. */
  lastSupplier: { name: string; receivedAt: string } | null;
}

const VIEWS: Array<{ value: string; label: string }> = [
  { value: 'attention', label: 'Needs re-ordering' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'OK', label: 'OK' },
  { value: 'NOT_SET', label: 'No Required Stock set' },
  // Nothing on hand anywhere: the Dashboard's Out of stock card opens this.
  { value: 'out', label: 'Out of stock' },
  { value: 'all', label: 'All items' },
];

export function StockStatus() {
  const items = useApi<StockStatusItem[]>('/reports/stock-status');
  const bands = useStatusBands();
  const isAdmin = useIsAdmin();
  const [q, setQ] = useState('');
  const [params] = useSearchParams();
  const [view, setView] = useState(() => (VIEWS.some((v) => v.value === params.get('view')) ? params.get('view')! : 'attention'));
  const [category, setCategory] = useState('');

  const counts = useMemo(() => {
    const c: Record<Status, number> = { URGENT: 0, WARNING: 0, OK: 0, NOT_SET: 0 };
    for (const r of items.data ?? []) c[r.status]++;
    return c;
  }, [items.data]);

  // What the download would hold: the items to re-order, in the chosen category if one is.
  const toReorder = (items.data ?? []).filter((r) => needsAttention(r.status) && (!category || r.category === category)).length;

  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (items.data ?? []).filter((r) => {
      if (view === 'attention' && !needsAttention(r.status)) return false;
      if (view === 'out' && num(r.onHand) > 0) return false;
      if (view !== 'attention' && view !== 'all' && view !== 'out' && r.status !== view) return false;
      if (category && r.category !== category) return false;
      if (terms.length > 0) {
        const hay = `${r.sku} ${r.name} ${r.locations.map((l) => l.locationName).join(' ')}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [items.data, q, view, category]);

  return (
    <div>
      <PageHeader
        title="Stock status"
        description={(
          <>
            Each item&apos;s stock on hand, across all locations, against its Required Stock: urgent below {bands.urgentBelowPercent}%,
            warning below {bands.warningBelowPercent}%, as the stock workbook&apos;s URGENCY column. The bands are
            under {isAdmin ? <Link to="/settings/inventory" className="btn-link">Settings → Inventory</Link> : 'Settings → Inventory'}.
          </>
        )}
        actions={(
          <div className="flex flex-wrap gap-2">
            <DownloadMenu
              label="Download re-order list"
              onDownload={(format) => (format === 'pdf' ? downloadReorderListPdf : downloadReorderList)(category || undefined)}
              disabled={!items.data || toReorder === 0}
            />
            {/* When the order arrives, it is booked on Receive stock. */}
            <RoleGuard roles={['ADMIN', 'STORE_CONTROLLER', 'PROCUREMENT']}>
              <Link to="/stock/receive" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                <Icon.ArrowDown size={14} /> Receive stock
              </Link>
            </RoleGuard>
            {PROCUREMENT_ENABLED && (
              <Link to="/purchase-orders" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                <Icon.Cart size={14} /> Create purchase order
              </Link>
            )}
          </div>
        )}
      />

      {items.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4" aria-label="Items by status">
          {([['URGENT', 'Urgent', 'text-danger-600'], ['WARNING', 'Warning', 'text-warning-600'], ['OK', 'OK', 'text-success-600'], ['NOT_SET', 'Not set', 'text-surface-600']] as const).map(([s, label, tone]) => (
            <button
              key={s}
              type="button"
              onClick={() => setView(s)}
              className={`surface-card p-3 text-left hover:border-brand-300 ${view === s ? 'border-brand-500' : ''}`}
            >
              <div className={`text-2xl font-semibold ${tone}`}>{counts[s]}</div>
              <div className="text-sm text-surface-600">{label}</div>
            </button>
          ))}
        </div>
      )}

      <FilterBar
        onClear={q || view !== 'attention' || category ? () => { setQ(''); setView('attention'); setCategory(''); } : undefined}
        count={items.loading ? 'Loading…' : `${filtered.length} of ${items.data?.length ?? 0}`}
      >
        <SearchField id="ss-search" value={q} onChange={setQ} placeholder="Item, code or location…" />
        <Field label="Show" htmlFor="ss-view" className={FILTER_WIDTH}>
          <Select id="ss-view" value={view} onChange={(e) => setView(e.target.value)}>
            {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Category" htmlFor="ss-category" className={FILTER_WIDTH}>
          <Select id="ss-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
      </FilterBar>

      {view === 'NOT_SET' && counts.NOT_SET > 0 && (
        <Alert tone="info" title="These items cannot be graded" className="mb-4">
          They have no Required Stock, so there is nothing to compare their stock on hand with. Open an item to set it, or see them
          all on <Link to="/materials?view=no-required" className="btn-link">Materials</Link>.
        </Alert>
      )}

      {items.error && <ErrorState message={items.error.message} onRetry={items.reload} />}

      {!items.error && (
        <DataTable
          ariaLabel="Stock status"
          isLoading={items.loading}
          rowKey={(r) => r.materialId}
          rows={filtered}
          columns={COLUMNS}
          emptyState={
            <EmptyState
              title={view === 'attention' ? 'Nothing needs re-ordering' : 'No items match'}
              description={view === 'attention' ? `Every item with a Required Stock has at least ${bands.warningBelowPercent}% of it on hand.` : 'Try another filter.'}
            />
          }
        />
      )}
    </div>
  );
}

const num = (s: string | null | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const COLUMNS: DataTableColumn<StockStatusItem>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (r) => (
      <div>
        <Link to={`/materials/${r.materialId}`} className="btn-link">{r.name}</Link>
        <div className="text-xs text-surface-500 font-mono">{r.sku}</div>
      </div>
    ),
  },
  {
    key: 'locations',
    header: 'Where',
    render: (r) => r.locations.length === 0
      ? <span className="text-surface-400">None on hand</span>
      : <span className="text-sm text-surface-700">{r.locations.map((l) => `${l.locationName} (${formatNumber(num(l.quantity))})`).join(', ')}</span>,
  },
  {
    key: 'onHand',
    header: 'On hand',
    align: 'right',
    className: 'text-num',
    render: (r) => (
      <div>
        <span className="font-mono">{formatNumber(num(r.onHand))} <span className="text-surface-500 text-xs">{r.unitOfMeasure}</span></span>
        {num(r.onLoan ?? '0') > 0 && <div className="text-xs text-surface-500">+{formatNumber(num(r.onLoan!))} checked out</div>}
      </div>
    ),
    width: '8rem',
  },
  {
    key: 'required',
    header: 'Required',
    align: 'right',
    className: 'text-num',
    render: (r) => num(r.requiredStock) > 0
      ? <span className="font-mono text-surface-600">{formatNumber(num(r.requiredStock))}</span>
      : <span className="text-surface-400">—</span>,
    width: '7rem',
  },
  {
    key: 'percent',
    header: '% of required',
    align: 'right',
    className: 'text-num',
    render: (r) => r.percentOfRequired === null
      ? <span className="text-surface-400">—</span>
      : <span className="font-mono">{r.percentOfRequired}%</span>,
    width: '8rem',
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StockStatusBadge status={r.status} percent={r.percentOfRequired} />,
    width: '7rem',
  },
  {
    key: 'supplier',
    header: 'Last supplier',
    render: (r) => r.lastSupplier
      ? <span className="text-sm text-surface-700" title={`Last delivered ${r.lastSupplier.receivedAt.slice(0, 10)}`}>{r.lastSupplier.name}</span>
      : <span className="text-surface-400">—</span>,
  },
  {
    key: 'reorder',
    header: 'Re-order qty',
    align: 'right',
    className: 'text-num',
    render: (r) => num(r.reorderQuantity) > 0
      ? <span className="font-mono font-medium">{formatNumber(num(r.reorderQuantity))}</span>
      : <span className="text-surface-400">—</span>,
    width: '8rem',
  },
];
