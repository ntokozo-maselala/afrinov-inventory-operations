import type { ReportInventoryLine } from '../mock/mockReport';
import { DataTable, type DataTableColumn } from './DataTable';
import { Badge } from './Badge';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { categoryLabel, statusLabel, statusTone } from '../lib/dashboardMetrics';
import { Skeleton } from './ui/skeleton';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState } from './EmptyState';

interface TopInventoryItemsProps {
  inventory: ReportInventoryLine[] | null;
  loading: boolean;
  error: { message: string } | null;
  currency: string;
}

export function TopInventoryItems({ inventory, loading, error, currency }: TopInventoryItemsProps) {
  const rows = (inventory ?? []).slice().sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 8);

  if (error) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Top Inventory Items</h3>
        <ErrorState title="Unable to load inventory" message={error.message} />
      </div>
    );
  }

  return (
    <div className="surface-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-h3 text-surface-900">Top Inventory Items</h3>
        <Link
          to="/reports/inventory"
          className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
        >
          View all inventory
        </Link>
      </div>

      {loading && !inventory ? (
        <Skeleton className="h-[280px] w-full" />
      ) : (
        <DataTable
          ariaLabel="Top inventory items by value"
          columns={columns(currency)}
          rows={rows}
          rowKey={(r) => `${r.materialId}-${r.locationId}`}
          isLoading={loading}
          loadingRows={8}
          compact={true}
          emptyState={
            <EmptyState
              title="No inventory data"
              description="No inventory lines are available for the selected filters."
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
      key: 'sku',
      header: 'SKU',
      className: 'text-mono',
      render: (r) => <span className="font-mono text-xs text-surface-500">{r.sku}</span>,
      width: '12rem',
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
      width: '11rem',
    },
    {
      key: 'location',
      header: 'Location',
      render: (r) => <span className="text-sm text-surface-700">{r.locationName}</span>,
      width: '9rem',
    },
    {
      key: 'qty',
      header: 'On Hand',
      align: 'right',
      className: 'text-num',
      render: (r) => <span className="font-mono">{formatNumber(r.quantity)}</span>,
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
          <span className="font-mono">{formatCurrency(r.inventoryValue, currency)}</span>
        ),
      width: '10rem',
    },
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
  ];
}
