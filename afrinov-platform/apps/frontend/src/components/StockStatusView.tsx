import { StatusBarChart, type StatusSegment } from './charts/StatusBarChart';
import type { ReportResult } from '../mock/mockReport';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';

const STATUS_COLORS: Record<string, string> = {
  IN_STOCK: 'var(--chart-in-stock)',
  LOW_STOCK: 'var(--chart-low-stock)',
  OUT_OF_STOCK: 'var(--chart-out-of-stock)',
};

const STATUS_LABELS: Record<string, string> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

export function StockStatusView({ report, loading }: { report: ReportResult | null; loading: boolean }) {
  const data = report?.byStatus ?? [];

  const segments: StatusSegment[] = data.map((s) => ({
    label: STATUS_LABELS[s.status] ?? s.status,
    value: s.quantity,
    color: STATUS_COLORS[s.status] ?? 'var(--chart-fallback)',
  }));

  const totalQty = data.reduce((acc, d) => acc + d.quantity, 0);
  const currency = report?.currency ?? 'ZAR';

  return (
    <div className="surface-card p-4">
      <h3 className="text-h3 text-surface-900 mb-3">Stock Status</h3>
      {loading && !report ? (
        <div className="h-[160px] flex items-center justify-center">
          <StatusBarChart data={[]} loading />
        </div>
      ) : (
        <div className="space-y-4">
          <StatusBarChart data={segments} height={48} />
          <div className="space-y-2 mt-3">
            {data.map((s) => {
              const pct = totalQty > 0 ? (s.quantity / totalQty) * 100 : 0;
              return (
                <div key={s.status} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[s.status] ?? 'var(--chart-fallback)' }}
                      aria-hidden="true"
                    />
                    <span className="text-sm text-surface-700">{STATUS_LABELS[s.status] ?? s.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-right text-sm">
                    <span className="text-surface-600">{formatNumber(s.quantity)} u</span>
                    <span className="text-surface-600 font-mono w-10">{pct.toFixed(0)}%</span>
                    <span className="text-surface-600 w-20 truncate">{formatCurrency(s.inventoryValue, currency)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
