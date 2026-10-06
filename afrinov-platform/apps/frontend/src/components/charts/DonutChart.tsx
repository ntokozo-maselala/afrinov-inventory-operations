import { Skeleton } from '../ui/skeleton';

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutDatum[];
  totalLabel?: string;
  loading?: boolean;
  emptyMessage?: string;
  valueFormatter?: (v: number) => string;
}

const RADIUS = 44;
const STROKE_WIDTH = 12;

export function DonutChart({
  data,
  totalLabel = 'total',
  loading,
  emptyMessage = 'No data',
  valueFormatter,
}: DonutChartProps) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const circumference = 2 * Math.PI * RADIUS;

  if (loading) {
    return (
      <div className="flex justify-center">
        <Skeleton className="h-28 w-28 rounded-full" />
      </div>
    );
  }

  if (total === 0 || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-surface-400">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--chart-track)" strokeWidth={STROKE_WIDTH} />
        </svg>
        <span className="mt-2 text-xs">{emptyMessage}</span>
      </div>
    );
  }

  const segments = data
    .filter((d) => d.value > 0)
    .reduce<Array<{ color: string; dasharray: string; dashoffset: number }>>((accum, d, _index) => {
      const portion = d.value / total;
      const len = portion * circumference;
      const currentOffset = accum.reduce((sum, seg) => {
        const dashParts = seg.dasharray.split(' ');
        return sum + Number(dashParts[0]);
      }, 0);
      accum.push({
        color: d.color,
        dasharray: `${len} ${circumference - len}`,
        dashoffset: -currentOffset,
      });
      return accum;
    }, []);

  const displayTotal = valueFormatter ? valueFormatter(total) : total.toLocaleString('en-ZA');

  return (
    <div className="relative flex flex-col items-center" role="img" aria-label={`Distribution: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
      <svg width="110" height="110" viewBox="0 0 110 110">
        <g transform="translate(55 55) rotate(-90)">
          <circle
            r={RADIUS}
            fill="none"
            stroke="var(--chart-track)"
            strokeWidth={STROKE_WIDTH}
          />
          {segments.map((seg, i) => (
            <circle
              key={i}
              r={RADIUS}
              fill="none"
              stroke={seg.color}
              strokeWidth={STROKE_WIDTH}
              strokeDasharray={seg.dasharray}
              strokeDashoffset={seg.dashoffset}
              strokeLinecap="butt"
            />
          ))}
        </g>
        <text
          x="55"
          y="48"
          textAnchor="middle"
          className="fill-surface-800"
          fontSize="16"
          fontWeight="600"
        >
          {displayTotal}
        </text>
        <text
          x="55"
          y="64"
          textAnchor="middle"
          className="fill-surface-500"
          fontSize="9"
        >
          {totalLabel}
        </text>
      </svg>

      {data.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {data.slice(0, 4).map((d) => (
            <div key={d.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} aria-hidden="true" />
              <span className="text-surface-600 truncate max-w-[12rem]">{d.label}</span>
              <span className="font-mono text-surface-700 ml-auto">{valueFormatter ? valueFormatter(d.value) : d.value.toLocaleString('en-ZA')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
