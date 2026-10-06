import { useMemo } from 'react';
import type { ReportResult } from '../mock/mockReport';
import { LineChart } from './charts/LineChart';
import { computeInventoryValueTrend } from '../lib/dashboardMetrics';
import { Skeleton } from './ui/skeleton';
import { ErrorState } from './EmptyState';
import { formatCurrency } from '../lib/currency';

export function InventoryValueChart({
  report,
  loading,
  error,
}: {
  report: ReportResult | null;
  loading: boolean;
  error?: { message: string } | null;
}) {
  const trendPoints = useMemo(() => {
    if (!report) return [];
    return computeInventoryValueTrend(
      report.movements,
      report.inventory,
      report.kpis.inventoryValue,
    );
  }, [report]);

  const chartData = useMemo(() => {
    return trendPoints.map((p) => ({
      label: p.label,
      date: p.date,
      value: p.value,
    }));
  }, [trendPoints]);

  const currency = report?.currency ?? 'ZAR';
  const totalValue = report?.kpis?.inventoryValue ?? 0;

  if (error) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Inventory Value Trend</h3>
        <ErrorState
          title="Unable to load inventory value data"
          message={error.message}
        />
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Inventory Value Trend</h3>
        <Skeleton className="h-[180px] w-full" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Inventory Value Trend</h3>
        <Skeleton className="h-[180px] w-full" />
      </div>
    );
  }

  return (
    <div className="surface-card p-4">
      <h3 className="text-h3 text-surface-900 mb-3">Inventory Value Trend</h3>
      <div className="space-y-4">
        <div className="text-right text-xs text-surface-500">
          Current value: {formatCurrency(totalValue, currency)}
        </div>
        <div className="h-[180px]">
          {chartData.length > 0 ? (
            <LineChart
              data={chartData}
              height={180}
              color="var(--chart-brand-500)"
              showArea={true}
              areaColor="var(--chart-brand-500)"
              currency={currency}
              empty={false}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-surface-400">
              <span>Insufficient movement data to compute a trend for the selected period.</span>
            </div>
          )}
        </div>
        <p className="text-xs text-surface-500">
          Cumulative inventory value based on receipts, issues, transfers, and adjustments over time.
        </p>
      </div>
    </div>
  );
}
