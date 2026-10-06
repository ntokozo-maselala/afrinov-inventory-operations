interface SkeletonProps {
  w?: number | string;
  h?: number | string;
  className?: string;
}

export function Skeleton({ w = '100%', h = 12, className = '' }: SkeletonProps) {
  return <span className={`inline-block bg-surface-100 rounded animate-pulse align-middle ${className}`} style={{ width: typeof w === 'number' ? `${w}px` : w, height: typeof h === 'number' ? `${h}px` : h }} />;
}