import { useEffect } from 'react';
import { useAuth } from '../auth';
import { Sidebar, CollapsedSidebar } from './Sidebar';
import { MobileDrawer } from './MobileDrawer';
import { AppHeader } from './AppHeader';
import { PageContainer } from './PageContainer';
import { DevModeBanner } from './DevModeBanner';
import { AppShellProvider, useAppShell } from '../hooks/useAppShell';
import { ToastProvider } from './Toast';
import { GlobalPreferencesApplier } from './GlobalPreferencesApplier';
import { useNavGroups } from '../hooks/useNavGroups';
import { TooltipProvider } from './ui/tooltip';
import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>
        <GlobalPreferencesApplier />
        <AppShellProvider>
          <AppShellInner>{children}</AppShellInner>
        </AppShellProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const event = new CustomEvent('afrinov:close-drawer');
        window.dispatchEvent(event);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 text-surface-800 dark:bg-surface-50 dark:text-surface-800">
      <DevModeBanner />
      <div className="flex min-h-screen">
        <DesktopSidebar />
        <MobileDrawer />
        <div className="flex-1 min-w-0 flex flex-col">
          <AppHeader user={user} onLogout={logout} />
          <PageContainer>{children}</PageContainer>
          <footer className="px-4 sm:px-6 lg:px-8 py-4 text-center text-xs text-surface-400 border-t border-surface-200 dark:text-surface-400 dark:border-surface-200">
            Afrinov IMS · prototype
          </footer>
        </div>
      </div>
    </div>
  );
}

function DesktopSidebar() {
  const { sidebarMode, isDesktop, isTablet, prefersReducedMotion } = useAppShell();
  const groups = useNavGroups();

  const transitionDuration = prefersReducedMotion ? '0ms' : '150ms';

  if (isDesktop && sidebarMode === 'expanded') {
    return (
      <aside className="hidden lg:flex shrink-0 sticky top-0 h-[100dvh] border-r border-surface-200 dark:border-surface-200" style={{ width: 'var(--sidebar-width-expanded)', transition: `width ${transitionDuration} ease-out` }}>
        <Sidebar groups={groups} />
      </aside>
    );
  }

  if ((isDesktop || isTablet) && sidebarMode === 'collapsed') {
    return (
      <aside className="hidden md:flex shrink-0 sticky top-0 h-[100dvh] border-r border-surface-200 dark:border-surface-200" style={{ width: 'var(--sidebar-width-collapsed)', transition: `width ${transitionDuration} ease-out` }}>
        <CollapsedSidebar groups={groups} />
      </aside>
    );
  }

  return null;
}