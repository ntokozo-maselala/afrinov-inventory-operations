import type { ReactNode } from 'react';
import { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizes: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-surface-900/50" aria-hidden="true" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`relative w-full ${sizes[size]} surface-card shadow-popover overflow-hidden flex flex-col max-h-[90vh]`}>
        <div className="px-5 py-4 border-b border-surface-200">
          <h2 id="modal-title" className="text-h2 text-surface-900">{title}</h2>
          {description && <p className="text-sm text-surface-500 mt-1">{description}</p>}
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3 bg-surface-50 border-t border-surface-200 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const drawerWidth: Record<NonNullable<DrawerProps['width']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Drawer({ open, onClose, title, description, children, footer, width = 'md' }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-surface-900/50" aria-hidden="true" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-labelledby="drawer-title" className={`relative w-full ${drawerWidth[width]} bg-surface-0 shadow-popover flex flex-col`}>
        <div className="px-5 py-4 border-b border-surface-200 flex items-start justify-between gap-3">
          <div>
            <h2 id="drawer-title" className="text-h2 text-surface-900">{title}</h2>
            {description && <p className="text-sm text-surface-500 mt-1">{description}</p>}
          </div>
          <button onClick={onClose} className="btn-icon" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 bg-surface-50 border-t border-surface-200 flex flex-wrap justify-end gap-2">{footer}</div>}
      </aside>
    </div>
  );
}