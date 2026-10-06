import { useMemo } from 'react';
import type { MockSupplier } from '../mock/types';
import type { PurchaseOrderSummary } from '../hooks/useDashboardData';
import { KPIGrid, type DashboardKPI } from './KPIGrid';
import { BarChart, type BarChartDatum } from './charts/BarChart';
import { DataTable, type DataTableColumn } from './DataTable';
import { Badge } from './Badge';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { computeSupplierKpis, computePOSupplierDistribution } from '../lib/dashboardMetrics';
import { Skeleton } from './ui/skeleton';
import { EmptyState, ErrorState } from './EmptyState';
import { Icon } from './Icon';
import { Link } from 'react-router-dom';

interface SupplierAnalyticsProps {
  suppliers: MockSupplier[] | null;
  purchaseOrders: PurchaseOrderSummary[] | null;
  currency: string;
  loading: boolean;
  error: { message: string } | null;
}

export function SupplierAnalytics({
  suppliers,
  purchaseOrders,
  currency,
  loading,
  error,
}: SupplierAnalyticsProps) {
  const kpis: DashboardKPI[] = useMemo(() => {
    if (!suppliers || !purchaseOrders) return Array.from({ length: 4 }, () => ({
      label: '',
      value: '',
      icon: null as unknown as JSX.Element,
      tone: 'neutral' as const,
      loading: true,
    }));

    const supKpis = computeSupplierKpis(suppliers, purchaseOrders, currency);
    return supKpis.map((k) => ({
      label: k.label,
      value: k.value,
      icon: supKpiIcon(k.label),
      tone: k.tone,
      loading: false,
      helper: k.helper,
      href: k.label === 'Active Suppliers' ? '/suppliers' : '/purchase-orders',
    }));
  }, [suppliers, purchaseOrders, currency]);

  const supplierDistribution = useMemo(() => {
    if (!purchaseOrders || !suppliers) return [];
    return computePOSupplierDistribution(purchaseOrders, suppliers);
  }, [purchaseOrders, suppliers]);

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorState title="Unable to load supplier data" message={error.message} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <KPIGrid kpis={kpis} loading={loading} skeletonCount={4} />

      <div className="surface-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-h3 text-surface-900">Top Suppliers by Purchase Volume</h3>
          <Link
            to="/suppliers"
            className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            View all suppliers
          </Link>
        </div>
        {loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : supplierDistribution.length > 0 ? (
          <div className="space-y-4">
            <div className="h-[160px]">
              <BarChart
                data={supplierDistribution.slice(0, 6).map((s): BarChartDatum => ({
                  label: s.supplierName.slice(0, 16),
                  groups: [{ series: 'Value', value: s.totalValue, color: 'var(--chart-brand-500)' }],
                }))}
                height={160}
                colors={['var(--chart-brand-500)']}
                valueFormatter={(v) => formatCurrency(v, currency)}
                legend={false}
                showGrid={true}
              />
            </div>
            <DataTable
              ariaLabel="Supplier purchase volume"
              columns={volumeColumns(currency)}
              rows={supplierDistribution.slice(0, 5)}
              rowKey={(r) => r.supplierId}
              isLoading={loading}
              loadingRows={5}
              compact={true}
              emptyState={
                <EmptyState
                  title="No supplier data"
                  description="No supplier purchase relationships found."
                />
              }
            />
          </div>
        ) : (
          <EmptyState
            title="No supplier data"
            description="No supplier relationships or purchase orders found in the selected period."
          />
        )}
      </div>

      <div className="surface-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-h3 text-surface-900">Active Suppliers</h3>
          <Link
            to="/suppliers"
            className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            View all suppliers
          </Link>
        </div>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (suppliers?.length ?? 0) > 0 ? (
          <DataTable
            ariaLabel="Active suppliers"
            columns={supplierColumns()}
            rows={(suppliers ?? []).filter((s) => s.active).slice(0, 8)}
            rowKey={(r) => r.id}
            isLoading={loading}
            loadingRows={6}
            compact={true}
            emptyState={
              <EmptyState
                title="No active suppliers"
                description="No active suppliers in the system."
              />
            }
          />
        ) : (
          <EmptyState
            title="No active suppliers"
            description="No active suppliers in the system."
          />
        )}
      </div>
    </div>
  );
}

function supKpiIcon(label: string): JSX.Element {
  if (label === 'Active Suppliers') return <Icon.Users size={18} />;
  if (label === 'Purchase Volume') return <Icon.Cart size={18} />;
  if (label === 'Avg. Order Value') return <Icon.Cash size={18} />;
  if (label === 'Top Supplier') return <Icon.Tag size={18} />;
  return <Icon.Users size={18} />;
}

function volumeColumns(currency: string): DataTableColumn<{
  supplierId: string;
  supplierName: string;
  orderCount: number;
  totalValue: number;
  receivedValue: number;
}>[] {
  return [
    { key: 'name', header: 'Supplier', render: (r) => r.supplierName, className: 'font-medium' },
    { key: 'orders', header: 'Orders', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatNumber(r.orderCount)}</span>, width: '6rem' },
    { key: 'value', header: 'Total Value', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatCurrency(r.totalValue, currency)}</span>, width: '10rem' },
    { key: 'received', header: 'Received', align: 'right', className: 'text-num', render: (r) => <span className="font-mono">{formatCurrency(r.receivedValue, currency)}</span>, width: '10rem' },
  ];
}

function supplierColumns(): DataTableColumn<MockSupplier>[] {
  return [
    { key: 'name', header: 'Supplier', render: (r) => <span className="text-sm font-medium">{r.name}</span> },
    { key: 'contact', header: 'Contact', render: (r) => <span className="text-sm text-surface-600">{r.contactName ?? '\u2014'}</span> },
    { key: 'email', header: 'Email', render: (r) => <span className="text-xs text-surface-500 truncate">{r.contactEmail ?? '\u2014'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.active ? 'success' : 'neutral'} dot>{r.active ? 'Active' : 'Inactive'}</Badge>, width: '8rem' },
  ];
}
