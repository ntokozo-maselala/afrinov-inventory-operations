import * as React from 'react';

import { cn } from '../../lib/cn';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-100 dark:bg-surface-100', className)}
      {...props}
    />
  );
}

export { Skeleton };

export function SkeletonText({ lines = 3, className, lineClassName = '' }: { lines?: number; className?: string; lineClassName?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-3 bg-surface-100 dark:bg-surface-100',
            i === lines - 1 && 'w-3/4',
            lineClassName,
          )}
        />
      ))}
    </div>
  );
}

export function KPISkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="surface-card p-4 flex flex-col min-h-[112px]"
        >
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
          <Skeleton className="h-7 w-3/4 mb-1" />
          <Skeleton className="h-3 w-1/2 mt-1" />
        </div>
      ))}
    </>
  );
}
