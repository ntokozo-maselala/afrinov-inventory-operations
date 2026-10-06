export interface BarChartDatum {
  label: string;
  groups: Array<{
    series: string;
    value: number;
    color?: string;
  }>;
}

export interface BarChartProps {
  data: BarChartDatum[];
  height?: number;
  colors?: string[];
  className?: string;
  showGrid?: boolean;
  loading?: boolean;
  empty?: boolean;
  valueFormatter?: (v: number) => string;
  legend?: boolean;
  id?: string;
}

const VB_W = 480;
const VB_H = 180;
const PADDING = { top: 20, right: 16, bottom: 40, left: 36 };

export function BarChart({
  data,
  height = 180,
  colors = ['#2FC112', '#dc2626', '#f59e0b'],
  className = '',
  showGrid = true,
  loading = false,
  empty = false,
  valueFormatter,
  legend = true,
}: BarChartProps) {
  const plotW = VB_W - PADDING.left - PADDING.right;
  const plotH = VB_H - PADDING.top - PADDING.bottom;

  const maxValue = Math.max(...data.flatMap((d) => d.groups.map((g) => g.value)), 1);
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxValue / 4) * (4 - i)));

  const groupWidth = plotW / Math.max(data.length, 1);
  const barGroupPadding = 0.15;
  const barGroupWidth = groupWidth * (1 - barGroupPadding);
  const seriesCount = data.length > 0 ? Math.max(...data.map((d) => d.groups.length)) : 0;
  const barWidth = seriesCount > 0 ? barGroupWidth / seriesCount : 0;
  const barGap = barWidth * 0.1;

  if (loading || (empty && data.length === 0)) {
    return (
      <div className={`relative ${className}`} style={{ height }}>
        {showGrid && Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-surface-100 dark:border-surface-200"
            style={{ top: `${PADDING.top + (plotH / 4) * i}px` }}
            aria-hidden="true"
          />
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-surface-400">
            {empty && data.length === 0 ? 'No data' : 'Loading…'}
          </span>
        </div>
      </div>
    );
  }

  const seriesNames = Array.from(
    new Set(data.flatMap((d) => d.groups.map((g) => g.series))),
  );

  return (
    <div className={`relative ${className}`} style={{ height }}>
      {legend && seriesNames.length > 0 && (
        <div className="absolute -top-6 right-0 flex items-center gap-3 text-xs">
          {seriesNames.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded"
                style={{ backgroundColor: colors[i % colors.length] }}
                aria-hidden="true"
              />
              <span className="text-surface-600">{s}</span>
            </span>
          ))}
        </div>
      )}

      {showGrid && (
        <svg
          className="absolute inset-0 h-full w-full text-surface-100 dark:text-surface-200"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {yTicks.map((tick, i) => (
            <line
              key={i}
              x1={PADDING.left}
              y1={PADDING.top + (i / 4) * plotH}
              x2={PADDING.left + plotW}
              y2={PADDING.top + (i / 4) * plotH}
              strokeWidth={1}
              stroke="currentColor"
            />
          ))}
        </svg>
      )}

      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-full" preserveAspectRatio="none">
        {data.map((d, i) => {
          const groupX = PADDING.left + i * groupWidth + barGroupPadding * groupWidth / 2;
          return d.groups.map((g, j) => {
            const barHeight = plotH * (g.value / maxValue);
            const barX = groupX + j * (barWidth + barGap);
            const barY = PADDING.top + plotH - barHeight;
            const fillColor = g.color ?? colors[j % colors.length];
            return (
              <g key={`${i}-${j}`}>
                <rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  fill={fillColor}
                  rx={2}
                  ry={2}
                />
                {barHeight > 8 && (
                  <text
                    x={barX + barWidth / 2}
                    y={barY + barHeight + 12}
                    textAnchor="middle"
                    className="fill-surface-500"
                    fontSize={10}
                  >
                    {valueFormatter ? valueFormatter(g.value) : g.value}
                  </text>
                )}
                <title>{`${g.series}: ${valueFormatter ? valueFormatter(g.value) : g.value}`}</title>
              </g>
            );
          });
        })}
      </svg>

      <div className="absolute -bottom-2 left-0 right-0 flex justify-between px-1">
        {data.map((d, i) => (
          <span
            key={i}
            className="text-xs text-surface-500 truncate max-w-[4rem] text-center"
            title={d.label}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
