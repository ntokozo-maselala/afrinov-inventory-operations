import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['ADMIN'] }, logout: vi.fn() }) }));
vi.mock('./Sidebar', () => ({ Sidebar: () => null, CollapsedSidebar: () => null }));
vi.mock('./MobileDrawer', () => ({ MobileDrawer: () => null }));
vi.mock('./AppHeader', () => ({ AppHeader: () => null }));
vi.mock('./DevModeBanner', () => ({ DevModeBanner: () => null }));
vi.mock('../hooks/useAppShell', () => ({
  AppShellProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAppShell: () => ({ sidebarMode: 'expanded', isDesktop: false, isTablet: false, prefersReducedMotion: true }),
}));
vi.mock('../hooks/useNavGroups', () => ({ useNavGroups: () => [] }));
vi.mock('./Toast', () => ({ ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./GlobalPreferencesApplier', () => ({ GlobalPreferencesApplier: () => null }));
vi.mock('./ui/tooltip', () => ({ TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const { AppShell } = await import('./AppShell');

describe('AppShell accessibility and page width', () => {
  it.each([
    ['/', 'max-w-full'],
    ['/materials', 'max-w-6xl'],
  ])('provides the main-content skip target on %s', (path, widthClass) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppShell><h1>Page heading</h1></AppShell>
      </MemoryRouter>,
    );

    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    const main = screen.getByRole('main');
    expect(skipLink).toHaveAttribute('href', '#main-content');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(main).toHaveClass(widthClass);
  });
});
