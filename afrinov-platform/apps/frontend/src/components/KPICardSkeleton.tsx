import { Skeleton } from './ui/skeleton';

export function KPICardSkeleton({ count = 6 }: { count?: number }) {
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
