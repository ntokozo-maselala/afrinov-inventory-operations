import { useMemo } from 'react';
import { isReversedPair, type ReportResult } from '../mock/mockReport';
import { BarChart, type BarChartDatum } from './charts/BarChart';
import { formatNumber } from '../lib/format';
import { Skeleton } from './ui/skeleton';
import { Icon } from './Icon';
import { ErrorState } from './EmptyState';

interface StockMovementAnalysisProps {
  report: ReportResult | null;
  loading: boolean;
  error?: { message: string } | null;
}

export function StockMovementAnalysis({ report, loading, error }: StockMovementAnalysisProps) {
  const movements = useMemo(() => report?.movements ?? [], [report?.movements]);
  const summary = report?.movementSummary;

  const barData: BarChartDatum[] = useMemo(() => {
    if (!movements.length) return [];

    const byDate = new Map<string, { receipts: number; issues: number }>();
    for (const m of movements) {
      if (isReversedPair(m)) continue;
      const day = m.postedAt.slice(0, 10);
      const entry = byDate.get(day) ?? { receipts: 0, issues: 0 };
      if (m.type === 'RECEIPT' || m.type === 'TRANSFER_IN' || m.type === 'RETURN') entry.receipts += Math.abs(m.quantity);
      else entry.issues += Math.abs(m.quantity);
      byDate.set(day, entry);
    }

    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .map(([date, vals]) => ({
        label: new Date(date).toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' }),
        groups: [
          { series: 'Received', value: vals.receipts, color: 'var(--chart-success-500)' },
          { series: 'Issued', value: vals.issues, color: 'var(--chart-danger-500)' },
        ],
      }));
  }, [movements]);

  const netMovement = useMemo(() => {
    if (!summary) return { direction: 'neutral' as const, value: 0, label: 'No data' };
    const receipts = summary.receipts.quantity;
    const issues = summary.issues.quantity;
    const net = receipts - issues;
    return {
      direction: net > 0 ? 'up' as const : net < 0 ? 'down' as const : 'neutral' as const,
      value: net,
      label: net > 0 ? 'Net inflow' : net < 0 ? 'Net outflow' : 'Balanced',
    };
  }, [summary]);

  if (error) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock Movement Analysis</h3>
        <ErrorState
          title="Unable to load movement data"
          message={error.message}
        />
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock Movement Analysis</h3>
        <Skeleton className="h-[180px] w-full mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="text-center">
              <Skeleton className="h-6 w-8 mx-auto mb-1" />
              <Skeleton className="h-3 w-16 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock Movement Analysis</h3>
        <Skeleton className="h-[180px] w-full mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="text-center">
              <Skeleton className="h-6 w-8 mx-auto mb-1" />
              <Skeleton className="h-3 w-16 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock Movement Analysis</h3>
        <div className="text-center py-8 text-surface-400">
          <Icon.Activity size={24} className="mx-auto mb-2 text-surface-300" />
          <p>No movement data for the selected period</p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card p-4">
      <h3 className="text-h3 text-surface-900 mb-3">Stock Movement Analysis</h3>
      <div className="space-y-4">
        <div className="h-[180px]">
          <BarChart
            data={barData}
            height={180}
            colors={['var(--chart-success-500)', 'var(--chart-danger-500)']}
            valueFormatter={(v) => formatNumber(v)}
            legend={true}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
          <SummaryStat
            icon={<Icon.ArrowUp size={12} className="text-success-500" />}
            value={formatNumber(summary?.receipts.count ?? 0)}
            label="Receipt events"
            subValue={formatNumber(summary?.receipts.quantity ?? 0)}
            subLabel="units received"
          />
          <SummaryStat
            icon={<Icon.ArrowDown size={12} className="text-danger-500" />}
            value={formatNumber(summary?.issues.count ?? 0)}
            label="Issue events"
            subValue={formatNumber(summary?.issues.quantity ?? 0)}
            subLabel="units issued"
          />
          <SummaryStat
            icon={<Icon.Activity size={12} className="text-info-500" />}
            value={formatNumber(summary?.transfers.count ?? 0)}
            label="Transfers"
            subValue={formatNumber(summary?.transfers.quantity ?? 0)}
            subLabel="units moved"
          />
          <SummaryStat
            icon={<Icon.Alert size={12} className="text-warning-500" />}
            value={formatNumber(summary?.adjustments.count ?? 0)}
            label="Adjustments"
            subValue={formatNumber(summary?.adjustments.quantity ?? 0)}
            subLabel="units adj."
          />
          <SummaryStat
            icon={
              netMovement.direction === 'up'
                ? <Icon.ArrowUp size={12} className="text-success-500" />
                : netMovement.direction === 'down'
                  ? <Icon.ArrowDown size={12} className="text-danger-500" />
                  : <Icon.Activity size={12} className="text-surface-400" />
            }
            value={formatNumber(netMovement.value)}
            label="Net movement"
            subValue={netMovement.label}
            subLabel="net result"
          />
        </div>
      </div>
    </div>
  );
}

function SummaryStat({
  icon,
  value,
  label,
  subValue,
  subLabel,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  subValue: string;
  subLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 mb-0.5">
        {icon}
        <span className="text-xl font-semibold text-surface-900 text-num">{value}</span>
      </div>
      <div className="text-xs text-surface-500">{label}</div>
      <div className="text-xs text-surface-600 font-mono">{subValue} {subLabel}</div>
    </div>
  );
}
