import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}>
      {icon && <div className="mb-3 text-surface-300" aria-hidden="true">{icon}</div>}
      <h3 className="text-h3 text-surface-800 mb-1">{title}</h3>
      {description && <p className="text-sm text-surface-500 max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}

export function TableLoading({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse p-1">
      <div className="h-9 bg-surface-100 rounded mb-2" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 mb-2">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-4 bg-surface-100 rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="surface-card p-6 text-center">
      <div className="mx-auto h-10 w-10 rounded-full bg-danger-50 text-danger-600 flex items-center justify-center mb-2" aria-hidden="true">!</div>
      <h3 className="text-h3 text-surface-800 mb-1">{title}</h3>
      {message && <p className="text-sm text-surface-500 max-w-md mx-auto mb-3">{message}</p>}
      {onRetry && <button onClick={onRetry} className="btn-secondary btn-sm">Try again</button>}
    </div>
  );
}