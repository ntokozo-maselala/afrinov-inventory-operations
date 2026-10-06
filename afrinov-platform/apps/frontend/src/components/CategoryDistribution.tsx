import type { ReportResult } from '../mock/mockReport';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { categoryLabel } from '../lib/dashboardMetrics';
import { Icon } from './Icon';
import { ErrorState } from './EmptyState';

const CATEGORY_COLORS: Record<string, string> = {
  FASTENERS_SLUGS_INSULATION: 'var(--chart-low-stock)',
  TOOLING_PPE_ELECTRICAL: 'var(--chart-info-500)',
  PROJECT_MATERIAL: 'var(--chart-brand-500)',
  CONSUMABLES: 'var(--chart-success-500)',
  TOOLS: 'var(--chart-warning-500)',
};

export function CategoryDistribution({
  report,
  loading,
  error,
}: {
  report: ReportResult | null;
  loading: boolean;
  error?: { message: string } | null;
}) {
  const data = report?.byCategory ?? [];
  const currency = report?.currency ?? 'ZAR';
  const totalValue = data.reduce((acc, d) => acc + d.inventoryValue, 0);

  if (error) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock by Category</h3>
        <ErrorState
          title="Unable to load category data"
          message={error.message}
        />
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock by Category</h3>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 w-3/4 bg-surface-100 rounded mb-1.5" />
              <div className="h-2.5 w-1/4 bg-surface-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock by Category</h3>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 w-3/4 bg-surface-100 rounded mb-1.5" />
              <div className="h-2.5 w-1/4 bg-surface-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock by Category</h3>
        <div className="text-center py-8 text-surface-400">
          <Icon.Layers size={24} className="mx-auto mb-2 text-surface-300" />
          <p>No category data available</p>
        </div>
      </div>
    );
  }

  const maxItem = data[0]?.inventoryValue ?? 1;

  return (
    <div className="surface-card p-4">
      <h3 className="text-h3 text-surface-900 mb-3">Stock by Category</h3>
      <div className="space-y-3.5">
        {data.map((d) => {
          const pct = totalValue > 0 ? (d.inventoryValue / totalValue) * 100 : 0;
          const barWidth = (d.inventoryValue / maxItem) * 100;
          return (
            <div key={d.category}>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-surface-700 font-medium">
                   {categoryLabel(d.category)}
                </span>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-xs text-surface-500">
                    {formatNumber(d.skuCount)} SKU \u00b7 {formatNumber(d.quantity)} u
                  </span>
                  <span className="font-mono text-surface-700 w-16 text-right">
                    {formatCurrency(d.inventoryValue, currency)}
                  </span>
                  <span className="text-xs text-surface-500 w-10 text-right">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-2.5 bg-surface-100 rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-300"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: CATEGORY_COLORS[d.category] ?? 'var(--chart-fallback)',
                    opacity: 0.8,
                  }}
                  role="progressbar"
                  aria-valuenow={Math.round(barWidth)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
