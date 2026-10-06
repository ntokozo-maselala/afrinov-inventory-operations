import { useMemo } from 'react';
import type { ReportResult, ReportStatusRow } from '../mock/mockReport';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { Skeleton } from './ui/skeleton';
import { Progress } from './ui/progress';
import { Icon } from './Icon';
import { ErrorState } from './EmptyState';

const STATUS_CONFIG: Record<string, { label: string; color: string; bgVar: string }> = {
  IN_STOCK: { label: 'In stock', color: 'var(--chart-success-500)', bgVar: 'bg-success-50' },
  LOW_STOCK: { label: 'Low stock', color: 'var(--chart-warning-500)', bgVar: 'bg-warning-50' },
  OUT_OF_STOCK: { label: 'Out of stock', color: 'var(--chart-out-of-stock)', bgVar: 'bg-danger-50' },
};

export function StockHealthView({
  report,
  loading,
  error,
}: {
  report: ReportResult | null;
  loading: boolean;
  error?: { message: string } | null;
}) {
  const memoStatusData = useMemo(() => report?.byStatus ?? [], [report?.byStatus]);
  const currency = report?.currency ?? 'ZAR';

  const totalQty = useMemo(
    () => memoStatusData.reduce((acc, s) => acc + s.quantity, 0),
    [memoStatusData],
  );
  const totalValue = useMemo(
    () => memoStatusData.reduce((acc, s) => acc + s.inventoryValue, 0),
    [memoStatusData],
  );
  const totalSKUs = useMemo(
    () => memoStatusData.reduce((acc, s) => acc + s.skuCount, 0),
    [memoStatusData],
  );

  const healthPct = totalSKUs > 0 ? ((memoStatusData.find((s) => s.status === 'IN_STOCK')?.skuCount ?? 0) / totalSKUs) * 100 : 0;
  const healthTone = healthPct >= 80 ? 'success' : healthPct >= 50 ? 'warning' : 'danger';
  const healthColor =
    healthTone === 'success'
      ? 'var(--chart-success-500)'
      : healthTone === 'warning'
        ? 'var(--chart-warning-500)'
        : 'var(--chart-danger-500)';

  if (error) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock Health</h3>
        <ErrorState
          title="Unable to load stock health data"
          message={error.message}
        />
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock Health</h3>
        <div className="space-y-3">
          <div className="flex justify-center">
            <Skeleton className="h-28 w-28 rounded-full" />
          </div>
          <div className="space-y-2.5 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-3 w-full bg-surface-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!memoStatusData.length) {
    return (
      <div className="surface-card p-4">
        <h3 className="text-h3 text-surface-900 mb-3">Stock Health</h3>
        <div className="text-center py-6 text-surface-400">
          <Icon.Layers size={24} className="mx-auto mb-2 text-surface-300" />
          <p>No stock data in the selected period</p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card p-4">
      <h3 className="text-h3 text-surface-900 mb-3">Stock Health</h3>
      <div className="space-y-4">
        <div className="text-center pb-2">
          <div className="text-3xl font-semibold text-surface-900 text-num mb-1">
            {healthPct.toFixed(0)}%
          </div>
          <p className="text-xs text-surface-500">SKU health score</p>
          <Progress
            value={healthPct}
            max={100}
            color={healthColor}
            className="mt-2 h-2"
            aria-label={`Health score: ${healthPct.toFixed(0)}%`}
          />
        </div>

        <div className="flex justify-center">
          <DonutChart data={memoStatusData} totalQty={totalQty} />
        </div>

        <div className="space-y-2 mt-2">
          {memoStatusData.map((s: ReportStatusRow) => {
            const cfg = STATUS_CONFIG[s.status] ?? {
              label: s.status,
              color: 'var(--chart-fallback)',
              bgVar: 'bg-surface-100',
            };
            const pct = totalQty > 0 ? (s.quantity / totalQty) * 100 : 0;
            return (
              <div key={s.status} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: cfg.color }}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-surface-700">{cfg.label}</span>
                </div>
                <div className="flex items-center gap-3 text-right text-sm">
                  <span className="text-surface-600 font-mono w-12">{formatNumber(s.skuCount)}</span>
                  <span className="text-surface-600 w-16 truncate">{formatCurrency(s.inventoryValue, currency)}</span>
                  <span className={`w-10 text-right font-mono ${pct > 0 ? 'text-surface-700' : 'text-surface-400'}`}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-2 border-t border-surface-200 text-center text-xs text-surface-500">
          {formatNumber(totalSKUs)} SKUs \u00b7 {formatNumber(totalQty)} units \u00b7 {formatCurrency(totalValue, currency)}
        </div>
      </div>
    </div>
  );
}

function DonutChart({
  data,
  totalQty,
}: {
  data: ReportStatusRow[];
  totalQty: number;
}) {
  const radius = 56;
  const inner = 28;
  const circumference = 2 * Math.PI * radius;
  const VB_SIZE = 130;

  const segments = data
    .filter((s) => s.quantity > 0)
    .reduce<Array<{ color: string; dasharray: string; dashoffset: number }>>((accum, s) => {
      const portion = s.quantity / totalQty;
      const len = portion * circumference;
      const currentOffset = accum.reduce((sum, seg) => {
        const dashParts = seg.dasharray.split(' ');
        return sum + Number(dashParts[0]);
      }, 0);
      accum.push({
        color: STATUS_CONFIG[s.status]?.color ?? 'var(--chart-fallback)',
        dasharray: `${len} ${circumference - len}`,
        dashoffset: -currentOffset,
      });
      return accum;
    }, []);

  if (totalQty === 0) {
    return (
      <div className="text-center text-xs text-surface-400 py-4">
        No inventory data
      </div>
    );
  }

  return (
    <div className="relative" role="img" aria-label="Stock status distribution">
      <svg viewBox={`0 0 ${VB_SIZE} ${VB_SIZE}`} className="w-full h-full max-w-[130px]">
        <g transform={`translate(${VB_SIZE / 2} ${VB_SIZE / 2}) rotate(-90)`}>
          <circle
            r={radius}
            fill="none"
            stroke="var(--chart-track)"
            strokeWidth={inner * 2}
          />
          {segments.map((seg, i) => (
            <circle
              key={i}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={inner * 2}
              strokeDasharray={seg.dasharray}
              strokeDashoffset={seg.dashoffset}
              strokeLinecap="butt"
            />
          ))}
        </g>
        <text
          x={VB_SIZE / 2}
          y={VB_SIZE / 2 - 8}
          textAnchor="middle"
          className="fill-surface-800"
          fontSize="16"
          fontWeight="600"
        >
          {formatNumber(totalQty)}
        </text>
        <text
          x={VB_SIZE / 2}
          y={VB_SIZE / 2 + 8}
          textAnchor="middle"
          className="fill-surface-500"
          fontSize="9"
        >
          total units
        </text>
      </svg>
      <div className="absolute -bottom-2 left-0 right-0 flex justify-center">
        {data.slice(0, 3).map((s) => {
          const cfg = STATUS_CONFIG[s.status] ?? {
            label: s.status,
            color: 'var(--chart-fallback)',
          };
          return (
            <span
              key={s.status}
              className="flex items-center gap-1 text-xs text-surface-500 mr-3"
            >
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: cfg.color }}
                aria-hidden="true"
              />
              {cfg.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
