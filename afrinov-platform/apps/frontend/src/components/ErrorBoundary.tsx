// React Error Boundary.
//
// Catches errors thrown while rendering a subtree and shows a calm fallback
// instead of a blank screen. It does not catch asynchronous failures,
// event-handler errors, or server faults — those are handled by the API client,
// the diagnostics sink and the backend error contract.
//
// A boundary only resets on an explicit user action (a key change remounts the
// subtree) or when the route changes, so a transient failure cannot silently
// loop. It never resets the whole application by itself.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';
import { reportError } from '../lib/diagnostics';
import { presentError, type PresentedError } from '../lib/errorPresentation';

interface Props {
  children: ReactNode;
  /** Named in the diagnostic event and the fallback, e.g. "Dashboard". */
  name: string;
  /** Custom fallback. Receives the presentation and a reset callback. */
  fallback?: (state: { error: PresentedError; reset: () => void }) => ReactNode;
  /** Rendered instead of the default full-page shell (e.g. inside a panel). */
  inline?: boolean;
  /** Called when the boundary resets, to let the owner re-fetch. */
  onReset?: () => void;
}

interface State {
  error: unknown | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The component stack is developer detail; reportError keeps it local (in
    // the diagnostic buffer and, in development, the console) and never shows
    // it to the user.
    reportError(info.componentStack ? `${String(error)}\n${info.componentStack}` : error, `boundary:${this.props.name}`);
  }

  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const presented = presentError(error);
    if (this.props.fallback) return this.props.fallback({ error: presented, reset: this.reset });

    return <ErrorFallback name={this.props.name} error={presented} onReset={this.reset} inline={this.props.inline} />;
  }
}

function ErrorFallback({ name, error, onReset, inline }: {
  name: string;
  error: PresentedError;
  onReset: () => void;
  inline?: boolean;
}) {
  const body = (
    <div role="alert" className="surface-card p-6 text-center max-w-lg mx-auto">
      <div className="mx-auto h-10 w-10 rounded-full bg-danger-50 text-danger-600 flex items-center justify-center mb-2" aria-hidden="true">!</div>
      <h2 className="text-h3 text-surface-800 mb-1">{error.title}</h2>
      <p className="text-sm text-surface-500 mb-1">{error.message}</p>
      {error.reference && (
        <p className="text-xs text-surface-400 mb-3">Reference: <span className="font-mono">{error.reference}</span></p>
      )}
      <div className="flex justify-center gap-2 mt-3">
        <Button variant="secondary" size="sm" onClick={onReset}>Try again</Button>
        <Button variant="ghost" size="sm" onClick={() => { window.location.href = '/'; }}>Back to dashboard</Button>
      </div>
      <p className="text-xs text-surface-400 mt-3">This section ({name}) failed to display. The rest of the application is unaffected.</p>
    </div>
  );
  if (inline) return <div className="py-6">{body}</div>;
  return <div className="min-h-[50vh] flex items-center justify-center p-6">{body}</div>;
}
