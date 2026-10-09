import { useMemo, useState, useCallback } from 'react';
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
import type { ReportResult, ReportInventoryLine } from '../mock/mockReport';
import type { StockStatusItem } from './StockStatus';
import { StockStatusBadge } from '../components/StockStatusBadge';

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
  const [range, setRange] = useState<string>('MONTH');

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set('range', range);
    p.set('stockStatus', 'ALL');
    p.set('itemStatus', 'ACTIVE');
    p.set('page', '1');
    p.set('pageSize', '200');
    return `/reports/inventory?${p.toString()}`;
  }, [range]);

  const { data: report, loading, error, reload } = useApi<ReportResult>(query);
  const { data: lowStock, loading: lowStockLoading } = useApi<StockStatusItem[]>('/reports/low-stock');

  const kpis = useMemo(() => {
    if (!report) return null;
    const k = report.kpis;
    return [
      { label: 'Total SKUs', value: formatNumber(k.skuCount), tone: 'brand' as const },
      { label: 'Total Quantity', value: formatNumber(k.totalQuantity), tone: 'info' as const },
      { label: 'Inventory Value', value: formatCurrency(k.inventoryValue, k.currency), tone: 'success' as const },
      { label: 'Low Stock', value: formatNumber(k.lowStockCount), tone: k.lowStockCount > 0 ? 'warning' as const : 'neutral' as const },
      { label: 'Out of Stock', value: formatNumber(k.outOfStockCount), tone: k.outOfStockCount > 0 ? 'danger' as const : 'neutral' as const },
    ];
  }, [report]);

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
  }, [reload]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory Dashboard"
        description="Overview of stock levels, inventory value, and item status."
        meta={
          report && !loading ? (
            <span className="text-xs text-surface-500">
              Updated {formatDateTime(report.generatedAt)} · {report.kpis.rangeLabel}
            </span>
          ) : null
        }
        actions={
          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="input"
              aria-label="Time range"
            >
              <option value="TODAY">Today</option>
              <option value="WEEK">This week</option>
              <option value="MONTH">This month</option>
              <option value="QUARTER">This quarter</option>
              <option value="YEAR">This year</option>
              <option value="ALL">All time</option>
            </select>
            <Button variant="ghost" size="sm" onClick={handleRefresh} loading={loading}>
              Refresh
            </Button>
            <Button variant="primary" size="sm" leadingIcon={<Icon.Box size={12} />} onClick={() => navigate('/materials')}>
              Add Item
            </Button>
          </div>
        }
      />

      {error && (
        <div className="surface-card p-4 flex items-center justify-between">
          <span className="text-sm text-danger-600">{error.message ?? 'Failed to load dashboard data.'}</span>
          <Button variant="secondary" size="sm" onClick={handleRefresh}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {loading && !kpis
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="surface-card p-4 animate-pulse">
                <div className="h-3 w-20 bg-surface-100 rounded mb-3" />
                <div className="h-6 w-24 bg-surface-100 rounded" />
              </div>
            ))
          : kpis?.map((kpi) => (
              <div key={kpi.label} className="surface-card p-4 flex flex-col">
                <span className="text-xs text-surface-500 mb-1">{kpi.label}</span>
                <span className={`text-xl font-semibold ${kpi.tone === 'brand' ? 'text-brand-700' : kpi.tone === 'success' ? 'text-success-700' : kpi.tone === 'warning' ? 'text-warning-700' : kpi.tone === 'danger' ? 'text-danger-700' : 'text-surface-900'}`}>
                  {kpi.value}
                </span>
              </div>
            ))}
      </div>

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
