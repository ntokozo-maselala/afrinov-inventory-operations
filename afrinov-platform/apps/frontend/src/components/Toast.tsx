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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, ...t }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const value: ToastContextValue = {
    show,
    success: (title, description) => show({ tone: 'success', title, description }),
    error: (title, description) => show({ tone: 'error', title, description }),
    info: (title, description) => show({ tone: 'info', title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 w-auto max-w-sm pointer-events-none sm:inset-auto sm:right-4 sm:bottom-4"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
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
    <div role="status" className={`pointer-events-auto surface-card border-l-4 ${toneClasses[toast.tone]} p-3 flex items-start gap-3 animate-[slideIn_120ms_ease-out]`}>
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