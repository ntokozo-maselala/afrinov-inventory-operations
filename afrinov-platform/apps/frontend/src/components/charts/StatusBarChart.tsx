export interface StatusSegment {
  label: string;
  value: number;
  color: string;
}

interface StatusBarChartProps {
  data: StatusSegment[];
  height?: number;
  className?: string;
  loading?: boolean;
  empty?: boolean;
}

const VB_W = 480;
const VB_H = 80;

export function StatusBarChart({ data, height = 80, className = '', loading, empty }: StatusBarChartProps) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const segments = data.filter((d) => d.value > 0);

  if (loading || empty) {
    return (
      <div className={`relative ${className}`} style={{ height }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-surface-400">
            {empty ? 'No data' : 'Loading…'}
          </span>
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className={`relative flex items-center justify-center ${className}`} style={{ height }}>
        <span className="text-xs text-surface-400">No stock data</span>
      </div>
    );
  }

  const barHeight = 14;

  return (
    <div className={`relative ${className}`} style={{ height }} role="img" aria-label="Stock status distribution">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-full" preserveAspectRatio="none">
        <g transform={`translate(0, 12)`}>
          {segments.reduce<JSX.Element[]>((accum, seg, index) => {
            const x = accum.length === 0 ? 0 : segments.slice(0, index).reduce((sum, s) => {
              const p = total > 0 ? (s.value / total) * 100 : 0;
              return sum + (p / 100) * VB_W;
            }, 0);
            const pct = total > 0 ? (seg.value / total) * 100 : 0;
            const segWidth = (pct / 100) * VB_W;
            accum.push(
              <g key={seg.label}>
                <rect x={x} y={0} width={Math.max(segWidth, 0)} height={barHeight} fill={seg.color} rx={2} ry={2} />
                <title>{`${seg.label}: ${seg.value} (${pct.toFixed(1)}%)`}</title>
              </g>,
            );
            return accum;
          }, [])}
        </g>
      </svg>

      <div className="absolute -bottom-[2px] left-0 right-0 flex justify-between px-1">
        {segments.map((seg) => {
          const pct = total > 0 ? (seg.value / total) * 100 : 0;
          if (pct < 5) return null;
          return (
            <span key={seg.label} className="text-xs text-surface-600 truncate max-w-[5rem] text-center" title={seg.label}>
              {seg.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
