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
import { useLocation } from 'react-router-dom';

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

/**
 * Renders navigation, a skip link, and scrollable page content within the viewport.
 * Uses the full content width on the dashboard route and closes the drawer on Escape.
 *
 * @throws {Error} If rendered without an AuthProvider.
 */
function AppShellInner({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const isDashboard = useLocation().pathname === '/';

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
    // The shell is pinned to the viewport and only the content column scrolls,
    // so the sidebar never moves when the page is scrolled.
    <div className={`h-[100dvh] flex flex-col overflow-hidden bg-surface-50 text-surface-800 dark:bg-surface-50 dark:text-surface-800`}>
      <DevModeBanner />
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="flex flex-1 min-h-0">
        <DesktopSidebar />
        <MobileDrawer />
        <div id="app-scroll-container" className="flex-1 min-w-0 flex flex-col overflow-y-auto">
          <AppHeader user={user} onLogout={logout} />
          <PageContainer maxWidth={isDashboard ? 'full' : 'lg'}>{children}</PageContainer>
          <footer className="px-4 sm:px-6 lg:px-8 py-4 text-center text-xs text-surface-400 border-t border-surface-200 dark:text-surface-400 dark:border-surface-200">
            Afrinov IMS © 2026. All rights reserved.
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
      <aside className="hidden lg:flex shrink-0 h-full border-r border-surface-200 dark:border-surface-200" style={{ width: 'var(--sidebar-width-expanded)', transition: `width ${transitionDuration} ease-out` }}>
        <Sidebar groups={groups} />
      </aside>
    );
  }

  if ((isDesktop || isTablet) && sidebarMode === 'collapsed') {
    return (
      <aside className="hidden md:flex shrink-0 h-full border-r border-surface-200 dark:border-surface-200" style={{ width: 'var(--sidebar-width-collapsed)', transition: `width ${transitionDuration} ease-out` }}>
        <CollapsedSidebar groups={groups} />
      </aside>
    );
  }

  return null;
}
