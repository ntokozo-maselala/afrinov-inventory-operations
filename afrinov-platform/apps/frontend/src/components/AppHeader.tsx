import { useAppShell } from '../hooks/useAppShell';
import { Icon } from './Icon';
import { Button } from './Button';
import type { AuthUser } from '../api/authService';

interface AppHeaderProps {
  user: AuthUser | null;
  onLogout: () => void;
}

export function AppHeader({ user, onLogout }: AppHeaderProps) {
  const { sidebarMode, isMobile, isTablet, isDesktop, toggleCollapsed, openMobile } = useAppShell();

  const showCollapseButton = isDesktop || isTablet;
  const showMobileMenu = isMobile;

  return (
    <header className="sticky top-0 z-[40] bg-surface-0/95 backdrop-blur border-b border-surface-200 dark:bg-surface-0/95 dark:border-surface-200">
      <div className="h-14 flex items-center gap-3 px-4 sm:px-6 lg:px-8">
        {showMobileMenu && (
          <button
            onClick={openMobile}
            className="btn-icon p-2"
            aria-label="Open navigation"
          >
            <Icon.Menu size={20} />
          </button>
        )}

        {showCollapseButton && (
          <button
            onClick={toggleCollapsed}
            className="btn-icon p-2"
            aria-label={sidebarMode === 'collapsed' ? 'Expand navigation' : 'Collapse navigation'}
            aria-pressed={sidebarMode === 'collapsed'}
          >
            {sidebarMode === 'collapsed' ? <Icon.Plus size={20} /> : <Icon.Minus size={20} />}
          </button>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-sm text-surface-700 dark:text-surface-700">
            <span className="h-8 w-8 rounded-full bg-surface-100 text-surface-700 flex items-center justify-center text-xs font-semibold dark:bg-surface-100 dark:text-surface-700">
              {user?.name?.split(' ').map((p: string) => p[0]).slice(0, 2).join('').toUpperCase() ?? '?'}
            </span>
            <span className="font-medium truncate max-w-[160px]">{user?.name}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout} className="hidden sm:inline-flex">
            <Icon.Logout size={14} /> Sign out
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="sm:hidden">
            <Icon.Logout size={18} />
          </Button>
        </div>
      </div>
    </header>
  );
}