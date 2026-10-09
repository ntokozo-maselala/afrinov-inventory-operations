import { useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useApi } from '../hooks/useApi';
import { formatNumber, formatDateTime } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import type { ReportResult, ReportInventoryLine } from '../api/reportTypes';
import type { StockStatusItem } from './StockStatus';
import { StockStatusBadge } from '../components/StockStatusBadge';
import { categoryLabel } from '../lib/categories';

/** GET /reports/stock-value: the stock on hand now, valued per category. */
export interface StockValue {
  currency: string;
  categories: Array<{ category: string; items: number; itemsInStock: number; value: number; unpriced: number; share: number }>;
  total: { items: number; itemsInStock: number; value: number; unpriced: number };
  status: { URGENT: number; WARNING: number; OK: number; NOT_SET: number; outOfStock: number };
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  IN_STOCK: 'success',
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

export function Dashboard() {
  const navigate = useNavigate();

  // Everything here is stock as it stands now, so there is no date range.
  const { data: report, loading, error, reload } = useApi<ReportResult>('/reports/inventory?range=ALL&stockStatus=ALL&itemStatus=ACTIVE&page=1&pageSize=200');
  const { data: lowStock, loading: lowStockLoading, reload: reloadLowStock } = useApi<StockStatusItem[]>('/reports/low-stock');
  const { data: value, loading: valueLoading, error: valueError, reload: reloadValue } = useApi<StockValue>('/reports/stock-value');

  const kpis = useMemo(() => {
    if (!value) return null;
    const s = value.status;
    return [
      {
        label: 'Stock value', value: formatCurrency(value.total.value, value.currency), tone: 'success' as const,
        note: value.total.unpriced > 0 ? `${value.total.unpriced} item${value.total.unpriced === 1 ? '' : 's'} in stock without a price` : 'excl. VAT',
      },
      { label: 'Items in stock', value: `${formatNumber(value.total.itemsInStock)} of ${formatNumber(value.total.items)}`, tone: 'brand' as const, to: '/stock' },
      { label: 'Urgent', value: formatNumber(s.URGENT), tone: s.URGENT > 0 ? 'danger' as const : 'neutral' as const, note: 'below 20% of required', to: '/reports/stock-status?view=URGENT' },
      { label: 'Warning', value: formatNumber(s.WARNING), tone: s.WARNING > 0 ? 'warning' as const : 'neutral' as const, note: 'below 40% of required', to: '/reports/stock-status?view=WARNING' },
      { label: 'Out of stock', value: formatNumber(s.outOfStock), tone: s.outOfStock > 0 ? 'danger' as const : 'neutral' as const, note: 'nothing on hand', to: '/reports/stock-status?view=all' },
    ];
  }, [value]);

  const attentionItems = useMemo(() => {
    if (!lowStock) return [];
    return lowStock.slice(0, 5);
  }, [lowStock]);

  const hasAttention = (lowStock?.length ?? 0) > 0;

  const columns = useMemo<DataTableColumn<ReportInventoryLine>[]>(() => [
    {
      key: 'sku',
      header: 'SKU',
      render: (row) => <span className="font-mono text-xs">{row.sku}</span>,
    },
    {
      key: 'name',
      header: 'Item',
      render: (row) => (
        <div>
          <div className="text-sm font-medium text-surface-900">{row.name}</div>
          {row.description && <div className="text-xs text-surface-500 truncate max-w-xs">{row.description}</div>}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => <span className="text-sm text-surface-600">{row.category}</span>,
    },
    {
      key: 'location',
      header: 'Location',
      render: (row) => <span className="text-sm text-surface-600">{row.locationName}</span>,
    },
    {
      key: 'quantity',
      header: 'Qty',
      align: 'right',
      render: (row) => <span className="text-sm text-surface-900">{formatNumber(row.quantity)}</span>,
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (row) => <span className="text-sm text-surface-900">{formatCurrency(row.inventoryValue, report?.currency ?? 'ZAR')}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} dot>
          {STATUS_LABEL[row.status] ?? row.status}
        </Badge>
      ),
    },
  ], [report?.currency]);

  const rows = report?.inventory ?? [];
  const rowKey = useCallback((row: ReportInventoryLine, index: number) => `${row.materialId}-${row.locationId}-${index}`, []);

  const handleRefresh = useCallback(() => {
    reload();
    reloadLowStock();
    reloadValue();
  }, [reload, reloadLowStock, reloadValue]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory Dashboard"
        description="Stock on hand now: its value per category, and the items that need re-ordering."
        meta={
          report && !loading ? (
            <span className="text-xs text-surface-500">
              Updated {formatDateTime(report.generatedAt)}
            </span>
          ) : null
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleRefresh} loading={loading}>
              Refresh
            </Button>
            <Button variant="primary" size="sm" leadingIcon={<Icon.Box size={12} />} onClick={() => navigate('/materials')}>
              Add Item
            </Button>
          </div>
        }
      />

      {(error ?? valueError) && (
        <div className="surface-card p-4 flex items-center justify-between">
          <span className="text-sm text-danger-600">{(error ?? valueError)?.message ?? 'Failed to load dashboard data.'}</span>
          <Button variant="secondary" size="sm" onClick={handleRefresh}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {valueLoading && !kpis
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="surface-card p-4 animate-pulse">
                <div className="h-3 w-20 bg-surface-100 rounded mb-3" />
                <div className="h-6 w-24 bg-surface-100 rounded" />
              </div>
            ))
          : kpis?.map((kpi) => {
              const body = (
                <>
                  <span className="text-xs text-surface-500 mb-1">{kpi.label}</span>
                  <span className={`text-xl font-semibold ${kpi.tone === 'brand' ? 'text-brand-700' : kpi.tone === 'success' ? 'text-success-700' : kpi.tone === 'warning' ? 'text-warning-700' : kpi.tone === 'danger' ? 'text-danger-700' : 'text-surface-900'}`}>
                    {kpi.value}
                  </span>
                  {kpi.note && <span className="text-xs text-surface-500 mt-1">{kpi.note}</span>}
                </>
              );
              return kpi.to
                ? <Link key={kpi.label} to={kpi.to} className="surface-card p-4 flex flex-col hover:border-brand-300">{body}</Link>
                : <div key={kpi.label} className="surface-card p-4 flex flex-col">{body}</div>;
            })}
      </div>

      {value && (
        <section aria-label="Stock value by category">
          <h2 className="text-h2 text-surface-900 mb-3">Stock value by category</h2>
          <div className="surface-card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="text-right">Items</th>
                  <th scope="col" className="text-right">In stock</th>
                  <th scope="col" className="text-right">Value excl. VAT</th>
                  <th scope="col" className="w-1/4">Share</th>
                </tr>
              </thead>
              <tbody>
                {value.categories.map((c) => (
                  <tr key={c.category}>
                    <td className="text-sm font-medium text-surface-900">
                      {categoryLabel(c.category)}
                      {c.unpriced > 0 && <span className="block text-xs text-surface-500">{c.unpriced} in stock without a price</span>}
                    </td>
                    <td className="text-right font-mono text-sm">{formatNumber(c.items)}</td>
                    <td className="text-right font-mono text-sm">{formatNumber(c.itemsInStock)}</td>
                    <td className="text-right font-mono text-sm">{formatCurrency(c.value, value.currency)}</td>
                    <td>
                      <div className="flex items-center gap-2" title={`${Math.round(c.share * 100)}% of the stock value`}>
                        <div className="h-2 flex-1 rounded bg-surface-100">
                          <div className="h-2 rounded bg-brand-500" style={{ width: `${Math.round(c.share * 100)}%` }} />
                        </div>
                        <span className="text-xs text-surface-500 w-9 text-right">{Math.round(c.share * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td>All categories</td>
                  <td className="text-right font-mono text-sm">{formatNumber(value.total.items)}</td>
                  <td className="text-right font-mono text-sm">{formatNumber(value.total.itemsInStock)}</td>
                  <td className="text-right font-mono text-sm">{formatCurrency(value.total.value, value.currency)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-surface-500 mt-2">
            On hand across all locations × unit price, added up row by row as the stock workbook&rsquo;s Summary sheets do.
          </p>
        </section>
      )}

      {hasAttention && (
        <section aria-label="Attention required">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-h2 text-surface-900">Attention Required</h2>
            <Link to="/reports/stock-status">
              <Button variant="secondary" size="sm">View all</Button>
            </Link>
          </div>
          <div className="surface-card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Material</th>
                  <th scope="col">Where</th>
                  <th scope="col" className="text-right">On Hand</th>
                  <th scope="col" className="text-right">Required</th>
                  <th scope="col" className="text-right">Re-order qty</th>
                  <th scope="col" className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {lowStockLoading ? (
                  Array.from({ length: 3 }).map((_, r) => (
                    <tr key={`__skel_${r}`} className="animate-pulse">
                      {Array.from({ length: 7 }).map((_, c) => (
                        <td key={c}><div className="h-3 w-3/4 bg-surface-100 rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : attentionItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <EmptyState title="No items need attention" description="Every item with a Required Stock has at least 40% of it on hand." />
                    </td>
                  </tr>
                ) : (
                  attentionItems.map((item, i) => {
                    const onHand = Number(item.onHand) || 0;
                    const required = Number(item.requiredStock) || 0;
                    const reorder = Number(item.reorderQuantity) || 0;
                    return (
                      <tr key={`${item.materialId}-${i}`} className="cursor-pointer" onClick={() => navigate(`/materials/${item.materialId}`)}>
                        <td>
                          <span className="font-mono text-xs">{item.sku}</span>
                        </td>
                        <td>
                          <span className="text-sm font-medium text-surface-900">{item.name}</span>
                        </td>
                        <td>
                          <span className="text-sm text-surface-600">{item.locations.map((l) => l.locationName).join(', ') || '—'}</span>
                        </td>
                        <td className="text-right">
                          <span className={`font-mono text-sm ${onHand <= 0 ? 'text-danger-600 font-medium' : 'text-surface-900'}`}>{formatNumber(onHand)}</span>
                        </td>
                        <td className="text-right">
                          <span className="font-mono text-sm text-surface-500">{formatNumber(required)}</span>
                        </td>
                        <td className="text-right">
                          <span className="font-mono text-sm font-medium">{formatNumber(reorder)}</span>
                        </td>
                        <td className="text-center">
                          <StockStatusBadge status={item.status} percent={item.percentOfRequired} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Inventory items">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-h2 text-surface-900">Inventory Items</h2>
          <Link to="/materials">
            <Button variant="secondary" size="sm">View all</Button>
          </Link>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          emptyState={
            <EmptyState
              title="No inventory items found"
              description="There are no items matching the current filters."
            />
          }
          isLoading={loading}
          loadingRows={8}
          ariaLabel="Inventory items"
        />
      </section>
    </div>
  );
}
