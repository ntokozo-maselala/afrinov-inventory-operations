import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { formatNumber } from '../lib/format';

/**
 * Canonical low-stock item shape returned by `GET /api/v1/reports/low-stock`.
 *
 * The backend (`ReportingService.lowStock()`) and the frontend mock
 * layer (`mockApi.ts` → `computeCurrentStock().filter(belowThreshold)`)
 * both return this exact shape, so the page renders identically in
 * live mode and in `VITE_FRONTEND_ONLY=true` mode.
 *
 * Fields are intentionally permissive on the input side (string-valued
 * decimals come from Prisma; the UI coerces with `Number()` and
 * `formatNumber()` which defends against `NaN` / `Infinity`).
 */
export interface LowStockItem {
  materialId: string;
  sku: string | null;
  name: string;
  unitOfMeasure: string | null;
  locationId: string;
  locationName: string;
  quantity: string;
  requiredStock: string;
}

/**
 * Domain rule for low-stock classification. Single source of truth —
 * used by both the table renderer and the filter dropdown so the page
 * and the API can never disagree about what "low" means.
 */
export type LowStockStatus = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';

export function classifyStock(onHand: number, reorderAt: number): LowStockStatus {
  if (onHand <= 0) return 'OUT_OF_STOCK';
  if (onHand <= reorderAt) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export function shortfallOf(onHand: number, reorderAt: number): number {
  return Math.max(0, reorderAt - onHand);
}

function toFinite(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function LowStock() {
  const low = useApi<LowStockItem[]>('/reports/low-stock');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!low.data) return [];
    const needle = q.trim().toLowerCase();
    return low.data.filter((r) => {
      const qty = toFinite(r.quantity);
      const req = toFinite(r.requiredStock);
      if (filter === 'out' && qty !== 0) return false;
      if (filter === 'low' && !(qty > 0 && qty <= req)) return false;
      if (needle) {
        const hay = `${r.sku ?? ''} ${r.name}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [low.data, q, filter]);

  return (
    <div>
      <PageHeader
        title="Low stock"
        description="Materials at or below their reorder threshold. Plan purchase orders from this list."
        actions={(
          <Link to="/purchase-orders" className="btn-primary btn-sm inline-flex items-center gap-1.5">
            <Icon.Cart size={14} /> Create purchase order
          </Link>
        )}
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search SKU or material…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search low stock" />
            </div>
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by severity">
              <option value="">All low</option>
              <option value="low">Low (above zero)</option>
              <option value="out">Out of stock</option>
            </Select>
            {(q || filter) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setFilter(''); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{low.loading ? 'Loading…' : `${filtered.length} of ${low.data?.length ?? 0}`}</span>}
      />

      {low.error && <ErrorState message={low.error.message} onRetry={low.reload} />}

      {!low.error && (
        <DataTable
          ariaLabel="Low stock items"
          isLoading={low.loading}
          rowKey={(r) => `${r.materialId}-${r.locationId}`}
          rows={filtered}
          columns={columns()}
          emptyState={
            <EmptyState
              title="No Low Stock Items"
              description="All inventory items are currently above their reorder thresholds."
            />
          }
        />
      )}
    </div>
  );
}

function columns(): DataTableColumn<LowStockItem>[] {
  return [
    {
      key: 'sku',
      header: 'SKU',
      className: 'text-mono',
      render: (r) => r.sku
        ? <Link to={`/materials/${r.materialId}`} className="btn-link text-mono">{r.sku}</Link>
        : <span className="text-mono text-surface-400" aria-label="No SKU">—</span>,
      width: '12rem',
    },
    {
      key: 'material',
      header: 'Item / Material',
      render: (r) => <span className="text-surface-900">{r.name || '—'}</span>,
    },
    {
      key: 'uom',
      header: 'UOM',
      width: '5rem',
      render: (r) => r.unitOfMeasure
        ? <span className="font-mono text-surface-600">{r.unitOfMeasure}</span>
        : <span className="text-surface-400" aria-label="No UOM">—</span>,
    },
    {
      key: 'location',
      header: 'Location',
      render: (r) => r.locationName
        ? <span className="text-surface-700">{r.locationName}</span>
        : <span className="text-surface-300">—</span>,
      width: '12rem',
    },
    {
      key: 'onHand',
      header: 'On Hand',
      align: 'right',
      className: 'text-num',
      render: (r) => <span className="font-mono font-medium">{formatNumber(toFinite(r.quantity))}</span>,
      width: '8rem',
    },
    {
      key: 'reorderAt',
      header: 'Reorder At',
      align: 'right',
      className: 'text-num',
      render: (r) => <span className="font-mono text-surface-500">{formatNumber(toFinite(r.requiredStock))}</span>,
      width: '8rem',
    },
    {
      key: 'shortfall',
      header: 'Shortfall',
      align: 'right',
      className: 'text-num',
      render: (r) => {
        const onHand = toFinite(r.quantity);
        const req = toFinite(r.requiredStock);
        const sf = shortfallOf(onHand, req);
        return (
          <span className={sf > 0 ? 'font-mono text-danger-700 font-medium' : 'font-mono text-surface-400'}>
            {formatNumber(sf)}
          </span>
        );
      },
      width: '8rem',
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const onHand = toFinite(r.quantity);
        const req = toFinite(r.requiredStock);
        const status = classifyStock(onHand, req);
        if (status === 'OUT_OF_STOCK') return <Badge tone="danger" dot>Out of Stock</Badge>;
        if (status === 'LOW_STOCK') return <Badge tone="warning" dot>Low Stock</Badge>;
        return <Badge tone="success" dot>In Stock</Badge>;
      },
      width: '9rem',
    },
  ];
}
