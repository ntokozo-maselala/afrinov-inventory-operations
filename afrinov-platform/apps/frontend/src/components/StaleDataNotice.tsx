// A non-blocking warning shown when a refresh failed but the data already on
// screen is still real. It must never replace the data: the point is that the
// figures shown are the last successfully loaded ones, not freshly confirmed.
import { Button } from './Button';
import { presentError } from '../lib/errorPresentation';

export function StaleDataNotice({ error, onRetry, label = 'Could not refresh' }: {
  error: unknown;
  onRetry?: () => void;
  label?: string;
}) {
  const presented = presentError(error);
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 rounded border border-warning-100 bg-warning-50 px-3 py-2 text-warning-700 mb-3">
      <div className="flex-1 min-w-0 text-sm">
        <span className="font-medium">{label}:</span>{' '}
        <span className="opacity-90">showing the last data that loaded. {presented.message}</span>
      </div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>{presented.retryLabel}</Button>}
    </div>
  );
}
