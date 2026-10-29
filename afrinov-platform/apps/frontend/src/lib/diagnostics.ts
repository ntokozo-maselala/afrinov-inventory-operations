// Client-side diagnostics sink.
//
// React Error Boundaries, unhandled promise rejections and window errors all
// report here. The sink keeps a small bounded buffer in memory and, in
// development, prints to the console. It is the single integration point for a
// real error-reporting service: replace `reportError`'s body (or subscribe with
// `onDiagnostic`) without touching the call sites.
//
// It deliberately does NOT send anything over the network: this repository has
// no error-collection endpoint, and inventing one that ships stack traces to an
// unknown destination would be worse than keeping them local.
import { presentError } from './errorPresentation';

export interface DiagnosticEvent {
  /** Where the failure was caught: a boundary name, or 'window'. */
  source: string;
  /** ISO timestamp. */
  at: string;
  /** The user-safe presentation (title/message/reference). */
  presentation: ReturnType<typeof presentError>;
  /** Developer detail: the message and stack, for authorized local logs only. */
  detail: string;
}

const MAX_EVENTS = 50;
const buffer: DiagnosticEvent[] = [];
const listeners = new Set<(event: DiagnosticEvent) => void>();

function describe(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Record a failure. Never throws: diagnostics must not become a new failure. */
export function reportError(err: unknown, source = 'unknown'): DiagnosticEvent {
  const event: DiagnosticEvent = {
    source,
    at: new Date().toISOString(),
    presentation: presentError(err),
    detail: describe(err),
  };
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) buffer.shift();
  if (import.meta.env.DEV) {
    // Authorized developer diagnostics stay useful in development.
    console.error(`[afrinov:${source}]`, err);
  }
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not take down the reporter.
    }
  }
  return event;
}

/** The recent diagnostic events, newest last. For authorized local inspection. */
export function recentDiagnostics(): readonly DiagnosticEvent[] {
  return buffer;
}

/** Subscribe to diagnostics; returns an unsubscribe function. */
export function onDiagnostic(listener: (event: DiagnosticEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Clear the buffer. Exposed for tests. */
export function resetDiagnostics(): void {
  buffer.length = 0;
  listeners.clear();
}

let installed = false;

/**
 * Install process-wide handlers for failures React Error Boundaries cannot
 * catch: promise rejections and errors thrown outside rendering. Idempotent.
 */
export function installGlobalErrorHandlers(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('unhandledrejection', (event) => {
    reportError((event as PromiseRejectionEvent).reason, 'unhandledrejection');
  });
  target.addEventListener('error', (event) => {
    reportError((event as ErrorEvent).error ?? (event as ErrorEvent).message, 'window.error');
  });
}
