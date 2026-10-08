import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { RoleGuard } from '../components/RoleGuard';
import { formatNumber } from '../lib/format';
import { StockActionForm, type StockActionKind } from '../components/StockActionForm';
import { AddStockItemForm } from '../components/AddStockItemForm';

interface StockRow {
  materialId: string; materialSku: string; materialName: string;
  category: string; unitOfMeasure: string; requiredStock: string;
  locationId: string; locationName: string; locationType: string;
  quantity: string; belowThreshold: boolean;
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'FASTENERS_SLUGS_INSULATION', label: 'Fasteners, slugs, insulation' },
  { value: 'TOOLING_PPE_ELECTRICAL', label: 'Tooling, PPE, electrical' },
  { value: 'PROJECT_MATERIAL', label: 'Project material' },
  { value: 'CONSUMABLES', label: 'Consumables' },
  { value: 'TOOLS', label: 'Tools' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ok', label: 'In stock' },
  { value: 'low', label: 'Below threshold' },
  { value: 'out', label: 'Out of stock' },
];

/** Show filtered stock balances with role-gated stock creation and issue actions. */
export function Stock() {
  const stock = useApi<StockRow[]>('/reports/current-stock');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [action, setAction] = useState<{ kind: StockActionKind; row: StockRow } | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const filtered = useMemo(() => {
    if (!stock.data) return [];
    const needle = q.trim().toLowerCase();
    return stock.data.filter((r) => {
      if (category && r.category !== category) return false;
      const qty = Number(r.quantity);
      if (status === 'ok' && (qty <= 0 || r.belowThreshold)) return false;
      if (status === 'low' && !(qty > 0 && r.belowThreshold)) return false;
      if (status === 'out' && qty !== 0) return false;
      if (needle) {
        const hay = `${r.materialSku} ${r.materialName} ${r.locationName}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [stock.data, q, category, status]);

  const activeFilters = (category ? 1 : 0) + (status ? 1 : 0) + (q ? 1 : 0);

  return (
    <div>
      <PageHeader
        title="Stock"
        description="Current on-hand quantities across all locations. Source of truth is the inventory transaction ledger."
        actions={
          <div className="flex flex-wrap gap-2">
          <RoleGuard roles={['ADMIN', 'STORE_CONTROLLER', 'TECHNICIAN']}>
            <Link to="/stock/issue">
              <Button variant="primary" leadingIcon={<Icon.ArrowRight size={14} />}>Issue stock</Button>
            </Link>
          </RoleGuard>
          <RoleGuard roles={['ADMIN', 'STORE_CONTROLLER']}>
            <Button
              variant="secondary"
              leadingIcon={<Icon.Plus size={14} />}
              onClick={() => setAdding(true)}
              aria-label="Add stock item"
            >
              Add stock item
            </Button>
          </RoleGuard>
          </div>
        }
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input
                placeholder="Search SKU, material, or location…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
                aria-label="Search stock"
              />
            </div>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(''); setCategory(''); setStatus(''); }}>
                Clear filters
              </Button>
            )}
          </>
        )}
        right={(
          <span className="text-meta">
            {stock.loading ? 'Loading…' : `${filtered.length} of ${stock.data?.length ?? 0} lines`}
          </span>
        )}
      />

      {stock.error && <ErrorState message={stock.error.message} onRetry={stock.reload} />}

      {!stock.error && (
        <DataTable<StockRow>
          ariaLabel="Stock lines"
          isLoading={stock.loading}
          rowKey={(r) => `${r.materialId}-${r.locationId}`}
          rows={filtered}
          columns={columns({ onAction: (kind, row) => setAction({ kind, row }) })}
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

      {adding && (
        <Drawer
          open
          onClose={() => setAdding(false)}
          title="Add stock item"
          description="Catalogue entry plus optional opening stock at a chosen location."
          width="lg"
        >
          <AddStockItemForm
            onCancel={() => setAdding(false)}
            onSaved={(_sku, msg) => { setAdding(false); stock.reload(); toast.success(msg); }}
            onError={(err) => toast.error('Could not add stock item', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}

function actionTitle(kind: StockActionKind, row: StockRow): string {
  return {
    issue: `Issue ${row.materialSku}`,
    transfer: `Transfer ${row.materialSku}`,
    adjust: `Adjust ${row.materialSku}`,
  }[kind];
}

function columns({ onAction }: { onAction: (kind: StockActionKind, row: StockRow) => void }): DataTableColumn<StockRow>[] {
  return [
    { key: 'sku', header: 'SKU', render: (r) => <Link to={`/materials/${r.materialId}`} className="btn-link text-mono">{r.materialSku}</Link>, width: '8rem' },
    { key: 'name', header: 'Material', render: (r) => <span className="line-clamp-1" title={r.materialName}>{r.materialName}</span> },
    { key: 'cat', header: 'Category', render: (r) => <span className="text-meta">{categoryLabel(r.category)}</span>, width: '12rem' },
    { key: 'loc', header: 'Location', render: (r) => r.locationName, width: '10rem' },
    { key: 'qty', header: 'On hand', align: 'right', className: 'text-num', render: (r) => <span className="font-mono font-medium">{formatNumber(Number(r.quantity))}</span>, width: '8rem' },
    { key: 'uom', header: 'UoM', render: (r) => r.unitOfMeasure, width: '6rem' },
    { key: 'reorder', header: 'Reorder', align: 'right', className: 'text-num', render: (r) => <span className="font-mono text-surface-500">{formatNumber(Number(r.requiredStock))}</span>, width: '8rem' },
    { key: 'status', header: 'Status', render: (r) => statusBadge(r), width: '10rem' },
    {
      key: 'actions', header: '', align: 'right', width: '11rem',
      render: (r) => (
        <RoleGuard roles={['ADMIN', 'STORE_CONTROLLER', 'TECHNICIAN']}>
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="secondary" onClick={() => onAction('issue', r)}>Issue</Button>
            <Button size="sm" variant="secondary" onClick={() => onAction('transfer', r)}>Transfer</Button>
            <Button size="sm" variant="ghost" onClick={() => onAction('adjust', r)}>Adjust</Button>
          </div>
        </RoleGuard>
      ),
    },
  ];
}

function statusBadge(r: StockRow) {
  const qty = Number(r.quantity);
  if (qty <= 0) return <Badge tone="danger" dot>Out</Badge>;
  if (r.belowThreshold) return <Badge tone="warning" dot>Low</Badge>;
  return <Badge tone="success" dot>OK</Badge>;
}

function categoryLabel(c: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}