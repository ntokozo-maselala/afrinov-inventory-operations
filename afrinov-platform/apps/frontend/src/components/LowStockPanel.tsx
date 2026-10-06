import type { ReportInventoryLine } from '../mock/mockReport';
import { DataTable, type DataTableColumn } from './DataTable';
import { Badge } from './Badge';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { categoryLabel, statusLabel, statusTone } from '../lib/dashboardMetrics';
import { Skeleton } from './ui/skeleton';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState } from './EmptyState';

interface LowStockPanelProps {
  exceptions: ReportInventoryLine[] | null;
  loading: boolean;
  error: { message: string } | null;
  currency: string;
}

export function LowStockPanel({ exceptions, loading, error, currency }: LowStockPanelProps) {
  const rows = (exceptions ?? []).sort((a, b) => {
    if (a.status === 'OUT_OF_STOCK' && b.status !== 'OUT_OF_STOCK') return -1;
    if (b.status === 'OUT_OF_STOCK' && a.status !== 'OUT_OF_STOCK') return 1;
    return a.quantity - b.quantity;
  });

  if (error) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Low Stock Items</h3>
        <ErrorState
          title="Unable to load inventory exceptions"
          message={error.message}
        />
      </div>
    );
  }

  return (
    <div className="surface-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-h3 text-surface-900">Low Stock Items</h3>
          <p className="text-xs text-surface-500 mt-0.5">
            {rows.length} item{rows.length === 1 ? '' : 's'} at or below reorder level
          </p>
        </div>
        {rows.length > 0 && (
          <Link
            to="/reports/low-stock"
            className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            View all items
          </Link>
        )}
      </div>

      {loading && !exceptions ? (
        <Skeleton className="h-[200px] w-full" />
      ) : (
        <DataTable
          ariaLabel="Low stock and out of stock items"
          columns={columns(currency)}
          rows={rows.slice(0, 10)}
          rowKey={(r) => `${r.materialId}-${r.locationId}`}
          isLoading={loading}
          loadingRows={6}
          compact={true}
          emptyState={
            <EmptyState
              title="No low stock items"
              description="All inventory items are above their reorder threshold. No out-of-stock items detected."
            />
          }
        />
      )}
    </div>
  );
}

function columns(currency: string): DataTableColumn<ReportInventoryLine>[] {
  return [
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const tone = statusTone(r.status);
        return (
          <Badge tone={tone} dot>
            {statusLabel(r.status)}
          </Badge>
        );
      },
      width: '8rem',
    },
    {
      key: 'sku',
      header: 'SKU',
      className: 'text-mono',
      render: (r) => <span className="font-mono text-xs text-surface-500">{r.sku}</span>,
      width: '10rem',
    },
    {
      key: 'name',
      header: 'Material',
      render: (r) => (
        <Link
          to={`/materials/${r.materialId}`}
          className="text-sm font-medium text-surface-800 hover:text-brand-700 hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (r) => <span className="text-meta">{categoryLabel(r.category)}</span>,
      width: '10rem',
    },
    {
      key: 'location',
      header: 'Location',
      render: (r) => <span className="text-sm text-surface-700">{r.locationName}</span>,
      width: '9rem',
    },
    {
      key: 'on-hand',
      header: 'On Hand',
      align: 'right',
      className: 'text-num',
      render: (r) => (
        <span
          className={`font-mono font-medium ${
            r.quantity <= 0
              ? 'text-danger-700'
              : r.quantity <= r.requiredStock
                ? 'text-warning-700'
                : 'text-surface-800'
          }`}
        >
          {formatNumber(r.quantity)}
        </span>
      ),
      width: '7rem',
    },
    {
      key: 'reorder',
      header: 'Reorder',
      align: 'right',
      className: 'text-num',
      render: (r) => (
        <span className="font-mono text-surface-500">{formatNumber(r.requiredStock)}</span>
      ),
      width: '7rem',
    },
    {
      key: 'shortfall',
      header: 'Shortfall',
      align: 'right',
      className: 'text-num',
      render: (r) => {
        const sf = Math.max(0, r.requiredStock - r.quantity);
        return (
          <span className={`font-mono ${sf > 0 ? 'text-danger-700' : 'text-surface-400'}`}>
            {sf > 0 ? formatNumber(sf) : '—'}
          </span>
        );
      },
      width: '7rem',
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      className: 'text-num',
      render: (r) =>
        r.unitCost === null ? (
          <span className="text-surface-300 font-mono">—</span>
        ) : (
          <span className="font-mono">
            {formatCurrency(Math.max(0, r.requiredStock - r.quantity) * r.unitCost, currency)}
          </span>
        ),
      width: '9rem',
    },
  ];
}
