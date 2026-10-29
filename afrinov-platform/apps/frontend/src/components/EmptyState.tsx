import type { ReactNode } from 'react';
import { presentError } from '../lib/errorPresentation';

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

export function ErrorState({ title, message, error, onRetry, retryLabel, className = '' }: {
  /** Explicit heading. Overrides the heading derived from `error`. */
  title?: string;
  /** Explicit body text. Overrides the text derived from `error`. */
  message?: string;
  /** A failure to present with approved, category-specific copy. */
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const presented = error !== undefined ? presentError(error) : null;
  const heading = title ?? presented?.title ?? 'Something went wrong';
  const body = message ?? presented?.message;
  // Only offer retry when the caller asked for it, and (when an error object
  // was given) when the category is actually worth retrying — never invite a
  // repeat of a failure that will just happen again.
  const showRetry = !!onRetry && (presented?.retryable ?? true);
  const tone = presented?.tone ?? 'danger';
  return (
    <div className={`surface-card p-6 text-center ${className}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className={`mx-auto h-10 w-10 rounded-full flex items-center justify-center mb-2 ${TONE_BADGE[tone]}`} aria-hidden="true">!</div>
      <h3 className="text-h3 text-surface-800 mb-1">{heading}</h3>
      {body && <p className="text-sm text-surface-500 max-w-md mx-auto mb-3">{body}</p>}
      {presented?.reference && (
        <p className="text-xs text-surface-400 mb-3">Reference: <span className="font-mono">{presented.reference}</span></p>
      )}
      {showRetry && <button onClick={onRetry} className="btn-secondary btn-sm">{retryLabel ?? presented?.retryLabel ?? 'Try again'}</button>}
    </div>
  );
}

const TONE_BADGE: Record<'info' | 'warning' | 'danger', string> = {
  info: 'bg-info-50 text-info-600',
  warning: 'bg-warning-50 text-warning-600',
  danger: 'bg-danger-50 text-danger-600',
};
