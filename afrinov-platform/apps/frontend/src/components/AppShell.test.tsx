import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

vi.mock('../auth', () => ({
  useAuth: () => ({ user: { name: 'Test User', roles: ['ADMIN'] }, logout: vi.fn() }),
}));
vi.mock('../api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({}) },
  FRONTEND_ONLY: false,
}));

describe('AppShell skip navigation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(['/', '/stock', '/settings'])('links to exactly one main-content target on %s', async (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppShell><h1>Page content</h1></AppShell>
      </MemoryRouter>,
    );

    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    const main = screen.getByRole('main');
    expect(skipLink).toHaveClass('skip-link');
    expect(skipLink).toHaveAttribute('href', `#${main.id}`);
    expect(main).toHaveAttribute('id', 'main-content');
    expect(document.querySelectorAll('[id="main-content"]')).toHaveLength(1);
    expect(within(main).getByRole('heading', { name: 'Page content' })).toBeInTheDocument();
    expect(skipLink.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Let the shell's preference request finish before the test unmounts it.
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('system'));
  });

  it('makes the skip link the first keyboard stop before application navigation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell><button>Page action</button></AppShell>
      </MemoryRouter>,
    );

    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(document.body).toHaveFocus();
  });
});
