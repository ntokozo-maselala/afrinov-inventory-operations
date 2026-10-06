import * as React from 'react';
import { formatCurrency } from '../../lib/currency';

export interface LineChartDatum {
  label: string;
  value: number;
  date?: string;
}

export interface LineChartProps {
  data: LineChartDatum[];
  height?: number;
  color?: string;
  areaColor?: string;
  showArea?: boolean;
  currency?: string;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  id?: string;
  valueFormatter?: (v: number) => string;
}

const VB_W = 480;
const VB_H = 200;
const PADDING = { top: 24, right: 24, bottom: 32, left: 40 };

export function LineChart({
  data,
  height = 200,
  color = 'var(--chart-brand-500)',
  areaColor,
  showArea = false,
  currency,
  loading = false,
  empty = false,
  emptyMessage = 'No data',
  id,
  valueFormatter,
}: LineChartProps) {
  const plotW = VB_W - PADDING.left - PADDING.right;
  const plotH = VB_H - PADDING.top - PADDING.bottom;

  const fmt = valueFormatter ?? ((v: number) => {
    if (currency) return formatCurrency(v, currency);
    return v.toLocaleString('en-ZA');
  });

  // Compute path before conditional returns to avoid rules-of-hooks violation
  const path = React.useMemo(() => {
    if (data.length === 0 || data.length === 1) {
      if (data.length === 1) {
        const values = data.map((d) => d.value);
        const maxValue = Math.max(...values, 1);
        const minValue = Math.min(...values, 0);
        const range = maxValue - minValue || 1;
        const paddedMax = maxValue + range * 0.08;
        const paddedMin = Math.max(0, minValue - range * 0.08);
        const yToPixelLocal = (v: number) => PADDING.top + plotH - ((v - paddedMin) / (paddedMax - paddedMin)) * plotH;
        const xToPixelLocal = (i: number) => PADDING.left + (i / Math.max(data.length - 1, 1)) * plotW;
        const x = xToPixelLocal(0);
        const y = yToPixelLocal(data[0]!.value);
        return `M ${x} ${PADDING.top} L ${x} ${y}`;
      }
      return '';
    }
    const values = data.map((d) => d.value);
    const maxValue = Math.max(...values, 1);
    const minValue = Math.min(...values, 0);
    const range = maxValue - minValue || 1;
    const paddedMax = maxValue + range * 0.08;
    const paddedMin = Math.max(0, minValue - range * 0.08);
    const yToPixelLocal = (v: number) => PADDING.top + plotH - ((v - paddedMin) / (paddedMax - paddedMin)) * plotH;
    const xToPixelLocal = (i: number) => PADDING.left + (i / Math.max(data.length - 1, 1)) * plotW;
    return data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xToPixelLocal(i)} ${yToPixelLocal(d.value)}`).join(' ');
  }, [data, plotW, plotH]);

  if (loading || (empty && data.length === 0)) {
    return (
      <div className="relative w-full" style={{ height }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-surface-100 dark:border-surface-200"
            style={{ top: PADDING.top + (plotH / 4) * i }}
            aria-hidden="true"
          />
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-surface-400">
            {loading ? 'Loading…' : emptyMessage}
          </span>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="relative w-full" style={{ height }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-surface-400">{emptyMessage}</span>
        </div>
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;
  const paddedMax = maxValue + range * 0.08;
  const paddedMin = Math.max(0, minValue - range * 0.08);

  const yToPixel = (v: number) => PADDING.top + plotH - ((v - paddedMin) / (paddedMax - paddedMin)) * plotH;
  const xToPixel = (i: number) => PADDING.left + (i / Math.max(data.length - 1, 1)) * plotW;

  const yTicks = 5;
  const tickValues = Array.from({ length: yTicks }, (_, i) =>
    paddedMin + ((paddedMax - paddedMin) / (yTicks - 1)) * (yTicks - 1 - i),
  );

  const areaFill = areaColor ?? `${color}10`;

  const areaPath = `${path} L ${xToPixel(data.length - 1)} ${PADDING.top + plotH} L ${xToPixel(0)} ${PADDING.top + plotH} Z`;

  return (
    <div className="relative w-full" style={{ height }}>
      {/* Y-axis grid lines */}
      <svg
        className="absolute inset-0 h-full w-full text-surface-100 dark:text-surface-200"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {tickValues.map((tv, i) => (
          <line
            key={i}
            x1={PADDING.left}
            y1={PADDING.top + (i / (yTicks - 1)) * plotH}
            x2={PADDING.left + plotW}
            y2={PADDING.top + (i / (yTicks - 1)) * plotH}
            strokeWidth={1}
            stroke="currentColor"
          />
        ))}
      </svg>

      {/* Main chart SVG */}
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-full" preserveAspectRatio="none">
        {tickValues.map((tv, i) => (
          <text
            key={i}
            x={PADDING.left - 8}
            y={PADDING.top + (i / (yTicks - 1)) * plotH + 4}
            textAnchor="end"
            className="fill-surface-500"
            fontSize={10}
          >
            {tv > 999 ? `${Math.round(tv / 1000)}k` : Math.round(tv).toString()}
          </text>
        ))}

        {showArea && (
          <path d={areaPath} fill={areaFill} />
        )}

        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <title>{id ?? 'Inventory value trend'}</title>
        </path>

        {data.map((d, i) => {
          const cx = xToPixel(i);
          const cy = yToPixel(d.value);
          return (
            <React.Fragment key={i}>
              <circle cx={cx} cy={cy} r={3.5} fill={color} />
              <title>{`${d.label}: ${fmt(d.value)}`}</title>
            </React.Fragment>
          );
        })}
      </svg>

      {/* X-axis labels */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1">
        {data.map((d, i) => {
          const show = i === 0 || i === data.length - 1 || (data.length <= 7 && i % 1 === 0) || (data.length > 7 && i % Math.ceil(data.length / 6) === 0);
          return (
            <span
              key={i}
              className="text-xs text-surface-500 truncate max-w-[4rem] text-center"
              title={d.label}
            >
              {show ? d.label : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
