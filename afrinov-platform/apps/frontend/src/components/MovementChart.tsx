import { BarChart, type BarChartDatum } from './charts/BarChart';
import { isReversedPair, type ReportResult } from '../mock/mockReport';

interface MovementChartProps {
  report: ReportResult | null;
  loading: boolean;
}

export function MovementChart({ report, loading }: MovementChartProps) {
  const movements = report?.movements ?? [];
  const summary = report?.movementSummary;

  if (loading && !report) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Inventory Movement</h3>
        <BarChart data={[]} loading height={160} />
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Inventory Movement</h3>
        <div className="h-[160px] flex items-center justify-center text-surface-400">
          No movement data for the selected period
        </div>
      </div>
    );
  }

  const groupedData: BarChartDatum[] = (() => {
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
          { series: 'Received', value: vals.receipts },
          { series: 'Issued', value: vals.issues },
        ],
      }));
  })();

  return (
    <div className="surface-card p-4">
      <h3 className="text-h3 text-surface-900 mb-3">Inventory Movement</h3>
      <div className="space-y-4">
        <BarChart
          data={groupedData}
          height={180}
          colors={['var(--chart-success-500)', 'var(--chart-danger-500)']}
        />
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-2xl font-semibold text-success-700 text-num">{summary.receipts.count}</div>
              <div className="text-xs text-surface-500">Receipt events</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-danger-700 text-num">{summary.issues.count}</div>
              <div className="text-xs text-surface-500">Issue events</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-info-700 text-num">{summary.transfers.count}</div>
              <div className="text-xs text-surface-500">Transfers</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-warning-700 text-num">{summary.adjustments.count}</div>
              <div className="text-xs text-surface-500">Adjustments</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
