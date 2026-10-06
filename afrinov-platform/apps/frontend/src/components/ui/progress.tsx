import * as React from 'react';

import { cn } from '../../lib/cn';

export function Progress({
  value,
  max = 100,
  className,
  color = 'var(--color-brand-500)',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
  max?: number;
  color?: string;
}) {
  const pct = value !== undefined ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-surface-100 dark:bg-surface-100',
        className,
      )}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      {...props}
    >
      <div
        className="h-full w-full flex-1 transition-all duration-300"
        style={{ width: `${pct}%`, backgroundColor: color }}
        aria-hidden="true"
      />
    </div>
  );
}

export function StockLevelIndicator({
  current,
  minimum,
  warning,
  className,
}: {
  current: number;
  minimum: number;
  warning?: number;
  className?: string;
}) {
  const max = Math.max(current, minimum, warning ?? minimum) * 1.2;

  let tone: 'success' | 'warning' | 'danger';
  if (current <= 0) tone = 'danger';
  else if (current <= minimum) tone = 'warning';
  else tone = 'success';

  const colorMap = {
    success: 'var(--chart-success-500)',
    warning: 'var(--chart-warning-500)',
    danger: 'var(--chart-danger-500)',
  };

  return (
    <Progress
      value={current}
      max={max}
      color={colorMap[tone]}
      className={cn('h-2', className)}
      aria-label={`Stock level: ${current} units, reorder at ${minimum}`}
    />
  );
}
