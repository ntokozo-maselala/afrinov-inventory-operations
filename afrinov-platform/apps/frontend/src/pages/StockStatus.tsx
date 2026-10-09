// Stock status: every item's stock on hand (all locations) against its
// Required Stock, graded URGENT / WARNING / OK as the stock workbook's
// URGENCY column does, with the re-order quantity. GET /reports/stock-status.
// The bands are settings (Settings → Inventory).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PROCUREMENT_ENABLED } from '../config/features';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { StockStatusBadge } from '../components/StockStatusBadge';
import { formatNumber } from '../lib/format';
import { needsAttention, type StockStatus as Status } from '../lib/stockStatus';
import { useToast } from '../components/Toast';
import { downloadReorderList } from '../api/exportReorderList';

/** One item, as GET /reports/stock-status returns it. */
export interface StockStatusItem {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  requiredStock: string;
  onHand: string;
  percentOfRequired: number | null;
  status: Status;
  reorderQuantity: string;
  unitCost: string | null;
  locations: Array<{ locationId: string; locationName: string; quantity: string }>;
  /** The supplier of the latest posted goods receipt with this item. */
  lastSupplier: { name: string; receivedAt: string } | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  CONSUMABLES: 'Consumables',
  FASTENERS_SLUGS_INSULATION: 'Fasteners, Slugs & Insulation',
  TOOLING_PPE_ELECTRICAL: 'Tooling, PPE & Electrical',
  PROJECT_MATERIAL: 'Project Material',
  TOOLS: 'Tools',
};

const VIEWS: Array<{ value: string; label: string }> = [
  { value: 'attention', label: 'Needs re-ordering' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'OK', label: 'OK' },
  { value: 'NOT_SET', label: 'No Required Stock set' },
  { value: 'all', label: 'All items' },
];

export function StockStatus() {
  const items = useApi<StockStatusItem[]>('/reports/stock-status');
  const [q, setQ] = useState('');
  const [view, setView] = useState('attention');
  const [category, setCategory] = useState('');
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  async function download() {
    setDownloading(true);
    try {
      await downloadReorderList();
    } catch (e) {
      toast.error('Download failed', (e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const counts = useMemo(() => {
    const c: Record<Status, number> = { URGENT: 0, WARNING: 0, OK: 0, NOT_SET: 0 };
    for (const r of items.data ?? []) c[r.status]++;
    return c;
  }, [items.data]);

  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (items.data ?? []).filter((r) => {
      if (view === 'attention' && !needsAttention(r.status)) return false;
      if (view !== 'attention' && view !== 'all' && r.status !== view) return false;
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
        description="Each item's stock on hand, across all locations, against its Required Stock: urgent below 20%, warning below 40%, as the stock workbook's URGENCY column. The bands are under Settings → Inventory."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Icon.Download size={14} />}
              onClick={download}
              loading={downloading}
              disabled={!items.data || counts.URGENT + counts.WARNING === 0}
            >
              Download re-order list
            </Button>
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

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search item, code or location…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock status" />
            </div>
            <Select className="sm:w-72" value={view} onChange={(e) => setView(e.target.value)} aria-label="Show">
              {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </Select>
            <Select className="sm:w-60" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            {(q || view !== 'attention' || category) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(''); setView('attention'); setCategory(''); }}>Clear</Button>
            )}
          </>
        )}
        right={<span className="text-meta">{items.loading ? 'Loading…' : `${filtered.length} of ${items.data?.length ?? 0}`}</span>}
      />

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
              description={view === 'attention' ? 'Every item with a Required Stock has at least 40% of it on hand.' : 'Try another filter.'}
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
    render: (r) => <span className="font-mono">{formatNumber(num(r.onHand))} <span className="text-surface-500 text-xs">{r.unitOfMeasure}</span></span>,
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
