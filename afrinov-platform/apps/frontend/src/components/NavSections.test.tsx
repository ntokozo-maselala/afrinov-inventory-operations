// Menu sections fold from their headers, remembered in this browser; the
// section holding the page being shown opens whenever the page changes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['ADMIN'] } }) }));
const { AppShellProvider } = await import('../hooks/useAppShell');
const { Sidebar } = await import('./Sidebar');
const { MobileNav } = await import('./MobileNav');

const GROUPS = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', end: true, icon: null }] },
  { title: 'Store', items: [{ to: '/stock', label: 'Stock', end: true, icon: null }, { to: '/stock/issue', label: 'Issue stock', icon: null }] },
  { title: 'Reports', items: [{ to: '/reports/stock-status', label: 'Stock status', icon: null }, { to: '/movements', label: 'Movements', icon: null }] },
  { title: 'Production', items: [] },
];
const STORAGE_KEY = 'afrinov.nav.folded';

function menu(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShellProvider>
        <Sidebar groups={GROUPS} />
        {/* A way to another page, as following a link does. */}
        <Link to="/movements">Go to Movements</Link>
      </AppShellProvider>
    </MemoryRouter>,
  );
  return within(screen.getByRole('navigation', { name: 'Main' }));
}

beforeEach(() => localStorage.clear());

describe('folding menu sections', () => {
  it('starts with every section open, and folds one from its header, remembering it', () => {
    const nav = menu();
    const reports = nav.getByRole('button', { name: 'Reports' });
    expect(reports).toHaveAttribute('aria-expanded', 'true');
    expect(nav.getByRole('link', { name: /Movements/ })).toBeVisible();

    fireEvent.click(reports);
    expect(reports).toHaveAttribute('aria-expanded', 'false');
    expect(nav.queryByRole('link', { name: /Movements/ })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['Reports']);

    fireEvent.click(reports);
    expect(nav.getByRole('link', { name: /Movements/ })).toBeVisible();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it('opens a remembered fold on the next visit only where the page being shown is not', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['Reports', 'Store']));
    const nav = menu('/stock');
    // Stock is the page shown, so Store opens; Reports stays folded.
    expect(nav.getByRole('button', { name: 'Store' })).toHaveAttribute('aria-expanded', 'true');
    expect(nav.getByRole('button', { name: 'Reports' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a folded section when its page is shown', () => {
    const nav = menu();
    fireEvent.click(nav.getByRole('button', { name: 'Reports' }));
    expect(nav.queryByRole('link', { name: /Movements/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Go to Movements' }));
    expect(nav.getByRole('button', { name: 'Reports' })).toHaveAttribute('aria-expanded', 'true');
    expect(nav.getByRole('link', { name: /Movements/ })).toBeVisible();
  });

  it('keeps a single-entry section and an empty one as plain headings', () => {
    const nav = menu();
    expect(nav.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(nav.getByText('Overview')).toBeInTheDocument();
    expect(nav.queryByRole('button', { name: 'Production' })).not.toBeInTheDocument();
    expect(nav.getByText('Production')).toBeInTheDocument();
  });

  it('survives storage it cannot read', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const nav = menu();
    expect(nav.getByRole('button', { name: 'Reports' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('folds the same way in the mobile menu', () => {
    render(<MemoryRouter><AppShellProvider><MobileNav groups={GROUPS as never} onNavigate={() => {}} /></AppShellProvider></MemoryRouter>);
    const nav = within(screen.getByRole('navigation', { name: 'Mobile navigation' }));
    const store = nav.getByRole('button', { name: 'Store' });
    expect(store).toHaveAttribute('aria-controls', 'mobile-nav-section-store');
    fireEvent.click(store);
    expect(store).toHaveAttribute('aria-expanded', 'false');
    expect(nav.queryByRole('link', { name: /Issue stock/ })).not.toBeInTheDocument();
  });
});
