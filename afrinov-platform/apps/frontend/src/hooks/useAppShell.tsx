import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { usePermissions } from './usePermissions';

export type SidebarMode = 'expanded' | 'collapsed' | 'mobile-open' | 'mobile-closed';

interface AppShellContextValue {
  sidebarMode: SidebarMode;
  sidebarWidth: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isLargeDesktop: boolean;
  prefersReducedMotion: boolean;
  toggleCollapsed: () => void;
  openMobile: () => void;
  closeMobile: () => void;
  setSidebarMode: (mode: SidebarMode) => void;
  hasPermission: (permission: string) => boolean;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;
const DESKTOP_LARGE_BREAKPOINT = 1440;

function getSidebarWidthFromCSS(mode: SidebarMode): number {
  if (typeof window === 'undefined') {
    switch (mode) {
      case 'expanded': return 220;
      case 'collapsed': return 68;
      case 'mobile-open': return 288;
      default: return 0;
    }
  }
  const style = getComputedStyle(document.documentElement);
  switch (mode) {
    case 'expanded': return parseInt(style.getPropertyValue('--sidebar-width-expanded') || '220', 10);
    case 'collapsed': return parseInt(style.getPropertyValue('--sidebar-width-collapsed') || '68', 10);
    case 'mobile-open': return parseInt(style.getPropertyValue('--sidebar-width-mobile') || '288', 10);
    default: return 0;
  }
}

export function AppShellProvider({ children }: { children: ReactNode }) {
  const { hasPermission } = usePermissions();

  const [sidebarMode, setSidebarModeState] = useState<SidebarMode>(() => {
    try {
      const stored = localStorage.getItem('afrinov.sidebarCollapsed');
      if (stored === '1') return 'collapsed';
    } catch {
      // ignore localStorage errors
    }
    return 'expanded';
  });
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth;
    return TABLET_BREAKPOINT;
  });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches); // eslint-disable-line react-hooks/set-state-in-effect
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches); // eslint-disable-line react-hooks/set-state-in-effect
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const isMobile = viewportWidth < MOBILE_BREAKPOINT;
  const isTablet = viewportWidth >= MOBILE_BREAKPOINT && viewportWidth < TABLET_BREAKPOINT;
  const isDesktop = viewportWidth >= TABLET_BREAKPOINT;
  const isLargeDesktop = viewportWidth >= DESKTOP_LARGE_BREAKPOINT;

  // Responsive behavior: only auto-switch on mobile.
  // Tablet and desktop respect user preference (persisted).
  useEffect(() => {
    if (isMobile && sidebarMode !== 'mobile-open' && sidebarMode !== 'mobile-closed') {
      setSidebarModeState('mobile-closed'); // eslint-disable-line react-hooks/set-state-in-effect
    } else if (isDesktop && (sidebarMode === 'mobile-open' || sidebarMode === 'mobile-closed')) {
      const stored = localStorage.getItem('afrinov.sidebarCollapsed');
      setSidebarModeState(stored === '1' ? 'collapsed' : 'expanded'); // eslint-disable-line react-hooks/set-state-in-effect
    }
    // Tablet: no auto-switch. User controls collapse/expand.
  }, [isMobile, isDesktop, sidebarMode]);

  const setSidebarMode = useCallback((mode: SidebarMode) => {
    setSidebarModeState(mode);
    if (mode === 'expanded' || mode === 'collapsed') {
      try {
        localStorage.setItem('afrinov.sidebarCollapsed', mode === 'collapsed' ? '1' : '0');
      } catch {
        // ignore localStorage errors
      }
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setSidebarModeState((current) => {
      if (current === 'expanded') return 'collapsed';
      if (current === 'collapsed') return 'expanded';
      return current;
    });
  }, []);

  const openMobile = useCallback(() => setSidebarMode('mobile-open'), [setSidebarMode]);
  const closeMobile = useCallback(() => setSidebarMode('mobile-closed'), [setSidebarMode]);

  const sidebarWidth = useMemo(() => getSidebarWidthFromCSS(sidebarMode), [sidebarMode]);

  const value = useMemo<AppShellContextValue>(() => ({
    sidebarMode,
    sidebarWidth,
    isMobile,
    isTablet,
    isDesktop,
    isLargeDesktop,
    prefersReducedMotion,
    toggleCollapsed,
    openMobile,
    closeMobile,
    setSidebarMode,
    hasPermission,
  }), [
    sidebarMode,
    sidebarWidth,
    isMobile,
    isTablet,
    isDesktop,
    isLargeDesktop,
    prefersReducedMotion,
    toggleCollapsed,
    openMobile,
    closeMobile,
    setSidebarMode,
    hasPermission,
  ]);

  return (
    <AppShellContext.Provider value={value}>
      {children}
    </AppShellContext.Provider>
  );
}

export function useAppShell(): AppShellContextValue {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error('useAppShell must be used within AppShellProvider');
  return ctx;
}