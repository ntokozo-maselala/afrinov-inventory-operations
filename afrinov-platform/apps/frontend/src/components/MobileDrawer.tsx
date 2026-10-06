import { useEffect, useRef, useCallback } from 'react';
import { MobileNav } from './MobileNav';
import { useAppShell } from '../hooks/useAppShell';
import { useNavGroups } from '../hooks/useNavGroups';
import { Icon } from './Icon';
import * as React from 'react';

function FocusTrap({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleTab);
    firstElement?.focus();

    return () => container.removeEventListener('keydown', handleTab);
  }, []);

  return <div ref={containerRef}>{children}</div>;
}

export function MobileDrawer() {
  const { sidebarMode, closeMobile, isMobile, prefersReducedMotion } = useAppShell();
  const navGroups = useNavGroups();
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const isOpen = sidebarMode === 'mobile-open';

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeMobile();
    }
  }, [closeMobile]);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);
      setTimeout(() => drawerRef.current?.focus(), 0);
    } else {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus();
    }
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  useEffect(() => {
    const handleCloseEvent = () => closeMobile();
    window.addEventListener('afrinov:close-drawer', handleCloseEvent);
    return () => window.removeEventListener('afrinov:close-drawer', handleCloseEvent);
  }, [closeMobile]);

  if (!isMobile || !isOpen) return null;

  const animationClass = prefersReducedMotion ? '' : 'animate-slide-in-left';

  return (
    <div className="fixed inset-0 z-[60] flex" role="dialog" aria-modal="true" aria-label="Navigation">
      <div
        className="absolute inset-0 bg-surface-900/50 dark:bg-surface-900/50"
        aria-hidden="true"
        onClick={closeMobile}
      />
      <FocusTrap>
        <aside
          ref={drawerRef}
          tabIndex={-1}
          className={`relative h-full w-full max-w-xs sm:max-w-sm bg-surface-0 shadow-popover flex flex-col dark:bg-surface-0 ${animationClass} border-l border-surface-200 dark:border-surface-200`}
          style={{ maxHeight: '100dvh' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-200 sticky top-0 bg-surface-0 dark:bg-surface-0 z-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-brand-50">
                <Icon.Box size={20} className="text-brand-600" />
              </span>
              <div className="leading-tight truncate">
                <div className="text-sm font-semibold text-surface-900 dark:text-surface-900">Afrinov IMS</div>
                <div className="text-xs text-surface-500 dark:text-surface-500">Inventory & Operations</div>
              </div>
            </div>
            <button
              onClick={closeMobile}
              className="btn-icon p-2 -mr-2"
              aria-label="Close navigation"
            >
              <Icon.X size={20} />
            </button>
          </div>
          <MobileNav groups={navGroups} onNavigate={closeMobile} />
          <div className="px-4 py-3 border-t border-surface-200 dark:border-surface-200">
            <div className="text-xs text-center text-surface-500 dark:text-surface-500">
              Afrinov IMS · prototype
            </div>
          </div>
        </aside>
      </FocusTrap>
    </div>
  );
}