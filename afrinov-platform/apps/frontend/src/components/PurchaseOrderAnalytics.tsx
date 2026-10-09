import { useMemo } from 'react';
import type { PurchaseOrderSummary } from '../hooks/useDashboardData';
import type { MockSupplier } from '../mock/types';
import { KPIGrid, type DashboardKPI } from './KPIGrid';
import { DonutChart } from './charts/DonutChart';
import { DataTable, type DataTableColumn } from './DataTable';
import { PurchaseOrderStatusBadge } from './Badge';
import { formatNumber, formatDate } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import {
  computePOStatusDistribution,
  computePOSupplierDistribution,
  computePOKpis,
} from '../lib/dashboardMetrics';
import { Skeleton } from './ui/skeleton';
import { EmptyState, ErrorState } from './EmptyState';
import { Icon } from './Icon';
import { Link } from 'react-router-dom';

interface PurchaseOrderAnalyticsProps {
  purchaseOrders: PurchaseOrderSummary[] | null;
  suppliers: MockSupplier[] | null;
  currency: string;
  loading: boolean;
  error: { message: string } | null;
}

const PO_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'var(--chart-info-500)',
  PENDING_APPROVAL: 'var(--chart-info-500)',
  APPROVED: 'var(--chart-brand-500)',
  PARTIALLY_RECEIVED: 'var(--chart-warning-500)',
  RECEIVED: 'var(--chart-success-500)',
  CLOSED: 'var(--chart-surface-500)',
  CANCELLED: 'var(--chart-danger-500)',
};

export function PurchaseOrderAnalytics({
  purchaseOrders,
  suppliers,
  currency,
  loading,
  error,
}: PurchaseOrderAnalyticsProps) {
  const memoPos = useMemo(() => purchaseOrders ?? [], [purchaseOrders]);

  const kpis: DashboardKPI[] = useMemo(() => {
    if (!purchaseOrders) return Array.from({ length: 5 }, () => ({
      label: '',
      value: '',
      icon: null as unknown as JSX.Element,
      tone: 'neutral' as const,
      loading: true,
    }));

    const poKpis = computePOKpis(purchaseOrders, currency);
    return poKpis.map((k) => ({
      label: k.label,
      value: k.value,
      icon: poKpiIcon(k.iconType),
      tone: k.tone,
      loading: false,
      helper: k.helper,
      href: '/purchase-orders',
    }));
  }, [purchaseOrders, currency]);

  const statusDistribution = useMemo(
    () => computePOStatusDistribution(memoPos),
    [memoPos],
  );

  const supplierDistribution = useMemo(
    () => computePOSupplierDistribution(memoPos, suppliers ?? []),
    [memoPos, suppliers],
  );

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorState
          title="Unable to load purchase order data"
          message={error.message}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <KPIGrid kpis={kpis} loading={loading} skeletonCount={5} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="surface-card p-4">
          <h3 className="text-h3 text-surface-900 mb-3">PO Status Distribution</h3>
          {loading ? (
            <Skeleton className="h-[200px] w-full" />
) : memoPos.length > 0 ? (
            <div className="flex justify-center">
              <DonutChart
                data={statusDistribution.map((s) => ({
                  label: s.label,
                  value: s.count,
                  color: PO_STATUS_COLORS[s.status] ?? 'var(--chart-fallback)',
                }))}
                totalLabel="orders"
                valueFormatter={(v) => formatNumber(v)}
              />
            </div>
          ) : (
            <EmptyState
              title="No purchase orders"
              description="No purchase orders have been created."
            />
          )}
        </div>

        <div className="surface-card p-4">
          <h3 className="text-h3 text-surface-900 mb-3">Top Suppliers by Volume</h3>
          {loading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : supplierDistribution.length > 0 ? (
            <DataTable
              ariaLabel="Purchase volume by supplier"
              columns={supplierColumns(currency)}
              rows={supplierDistribution.slice(0, 5)}
              rowKey={(r) => r.supplierId}
              isLoading={loading}
              loadingRows={5}
              compact={true}
              emptyState={
                <EmptyState
                  title="No supplier data"
                  description="No supplier relationships found."
                />
              }
            />
          ) : (
            <EmptyState
              title="No supplier data"
              description="No supplier relationships found."
            />
          )}
        </div>
      </div>

      <div className="surface-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-h3 text-surface-900">Recent Purchase Orders</h3>
          <Link
            to="/purchase-orders"
            className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            View all
          </Link>
        </div>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : memoPos.length > 0 ? (
          <DataTable
            ariaLabel="Recent purchase orders"
            columns={recentPOColumns(currency)}
            rows={memoPos.slice(0, 8)}
            rowKey={(r) => r.id}
            isLoading={loading}
            loadingRows={6}
            compact={true}
            emptyState={
              <EmptyState
                title="No purchase orders"
                description="No purchase orders have been created."
              />
            }
          />
        ) : (
          <EmptyState
            title="No purchase orders"
            description="No purchase orders have been created."
          />
        )}
      </div>
    </div>
  );
}

function poKpiIcon(type: string) {
  switch (type) {
    case 'doc':
      return <Icon.Doc size={18} />;
    case 'cash':
      return <Icon.Cash size={18} />;
    case 'alert':
      return <Icon.Alert size={18} />;
    default:
      return <Icon.Chart size={18} />;
  }
}

function supplierColumns(currency: string): DataTableColumn<{
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

function recentPOColumns(currency: string): DataTableColumn<PurchaseOrderSummary>[] {
  return [
    { key: 'number', header: 'PO #', render: (r) => <span className="font-mono text-xs">{r.number}</span>, width: '10rem' },
    { key: 'supplier', header: 'Supplier', render: (r) => <span className="text-sm">{r.supplier?.name ?? '\u2014'}</span> },
    { key: 'status', header: 'Status', render: (r) => <PurchaseOrderStatusBadge status={r.status} />, width: '10rem' },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      className: 'text-num',
      render: (r) => (
        <span className="font-mono">
          {r.lines && r.lines.length > 0
            ? formatCurrency(
                r.lines.reduce((acc, line) => {
                  const orderedQty = Number(line.orderedQty ?? 0);
                  const unitCost = Number(line.material?.unitCost ?? 0);
                  return acc + orderedQty * unitCost;
                }, 0),
                currency,
              )
            : '\u2014'}
        </span>
      ),
      width: '9rem',
    },
    {
      key: 'delivery',
      header: 'Expected Delivery',
      render: (r) => (
        <span className="text-meta">
          {r.expectedDeliveryDate ? formatDate(r.expectedDeliveryDate) : '\u2014'}
        </span>
      ),
      width: '10rem',
    },
  ];
}
