import { createContext, useCallback, useContext, useState, useRef } from 'react';
import type { ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  show: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Short-lived confirmations fade quickly; a failure the user must notice stays
// long enough to read and act on. Errors do not auto-dismiss by themselves —
// they are dismissed by the user or superseded — because a message that
// vanishes before it is read is a silent failure in disguise.
const DISMISS_MS: Record<ToastTone, number | null> = {
  success: 4500,
  info: 4500,
  warning: 8000,
  error: null,
};

// Identical messages arriving in quick succession (a burst of failing requests
// during one outage) collapse into a single toast instead of a stack of them.
const DEDUPE_WINDOW_MS = 4000;

// Error toasts do not auto-dismiss, so a long outage producing distinct
// messages would otherwise fill the screen and stay until each is dismissed by
// hand. Only the most recent are kept; the oldest is dropped as a new one
// arrives, so the latest failure is always visible and the stack is bounded.
const MAX_ERROR_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const recent = useRef(new Map<string, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((t: Omit<Toast, 'id'>) => {
    const key = `${t.tone}|${t.title}|${t.description ?? ''}`;
    const now = Date.now();
    // Evict dedupe entries once their window has passed, so a long-lived
    // provider does not accumulate a key per distinct message forever.
    for (const [k, at] of recent.current) {
      if (now - at >= DEDUPE_WINDOW_MS) recent.current.delete(k);
    }
    const last = recent.current.get(key);
    if (last !== undefined) return;
    recent.current.set(key, now);

    const id = ++counter.current;
    setToasts((prev) => {
      const next = [...prev, { id, ...t }];
      if (t.tone !== 'error') return next;
      // Keep only the most recent persistent errors: the newest failure is
      // never lost, and the stack cannot grow without bound during an outage.
      const errors = next.filter((x) => x.tone === 'error');
      if (errors.length <= MAX_ERROR_TOASTS) return next;
      const dropped = new Set(errors.slice(0, errors.length - MAX_ERROR_TOASTS).map((x) => x.id));
      return next.filter((x) => !dropped.has(x.id));
    });
    const ttl = DISMISS_MS[t.tone];
    if (ttl !== null) setTimeout(() => dismiss(id), ttl);
  }, [dismiss]);

  const value: ToastContextValue = {
    show,
    success: (title, description) => show({ tone: 'success', title, description }),
    error: (title, description) => show({ tone: 'error', title, description }),
    info: (title, description) => show({ tone: 'info', title, description }),
  };

  // Errors are announced assertively (they interrupt); other tones politely.
  // Two regions keep the politeness correct per message without re-announcing
  // the whole stack when one is added.
  const errors = toasts.filter((t) => t.tone === 'error');
  const rest = toasts.filter((t) => t.tone !== 'error');

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 w-auto max-w-sm pointer-events-none sm:inset-auto sm:right-4 sm:bottom-4"
      >
        <div aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
          {errors.map((t) => <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
        </div>
        <div aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
          {rest.map((t) => <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

const toneClasses: Record<ToastTone, string> = {
  success: 'border-success-500 bg-surface-0',
  error: 'border-danger-500 bg-surface-0',
  info: 'border-info-500 bg-surface-0',
  warning: 'border-warning-500 bg-surface-0',
};

const toneAccent: Record<ToastTone, string> = {
  success: 'bg-success-500',
  error: 'bg-danger-500',
  info: 'bg-info-500',
  warning: 'bg-warning-500',
};

function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto surface-card border-l-4 ${toneClasses[toast.tone]} p-3 flex items-start gap-3 motion-safe:animate-[slideIn_120ms_ease-out]`}
    >
      <span aria-hidden="true" className={`mt-1 h-2 w-2 rounded-full ${toneAccent[toast.tone]}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-surface-900">{toast.title}</div>
        {toast.description && <div className="text-xs text-surface-500 mt-0.5">{toast.description}</div>}
      </div>
      <button onClick={onDismiss} className="btn-icon" aria-label="Dismiss notification">×</button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

// Inline keyframe (Tailwind doesn't include `slideIn` by default).
// Defined as a global rule so we don't need a custom CSS file just for this.
if (typeof document !== 'undefined') {
  const id = 'afrinov-toast-keyframes';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `@keyframes slideIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
    document.head.appendChild(style);
  }
}