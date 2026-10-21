import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setAppearance } from './hooks/useAppearance';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  auth: { user: { roles: ['ADMIN'] } as { roles: string[] } | null, loading: false },
}));
vi.mock('./auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('./api/client', () => ({ api: { get: mocks.get }, FRONTEND_ONLY: false }));
vi.mock('./components/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));
vi.mock('./components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./config/features', () => ({ PROCUREMENT_ENABLED: true }));
vi.mock('./pages/PurchaseOrders', () => ({ PurchaseOrders: () => <h1>Purchase orders list</h1> }));
vi.mock('./pages/Login', () => ({ Login: () => <h1>Sign in</h1> }));

const { App } = await import('./App');

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({});
  mocks.auth.user = { roles: ['ADMIN'] };
  mocks.auth.loading = false;
  setAppearance({ theme: 'light', density: 'comfortable' });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setAppearance({ theme: 'light', density: 'comfortable' });
  localStorage.clear();
});

describe('retired goods receipts route', () => {
  it.each(['/goods-receipts', '/goods-receipts/GR-2026-0001'])('redirects %s to the purchase orders list', async (path) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Purchase orders list' })).toBeInTheDocument();
  });
});

describe('theme initialization at the protected route boundary', () => {
  it('holds back the app shell until preferences have been applied', async () => {
    let resolve!: (values: Record<string, string>) => void;
    mocks.get.mockReturnValue(new Promise((res) => { resolve = res; }));
    render(<MemoryRouter initialEntries={['/purchase-orders']}><App /></MemoryRouter>);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Purchase orders list' })).not.toBeInTheDocument();

    await act(async () => resolve({ 'appearance.theme': 'dark', 'appearance.density': 'compact' }));

    expect(await screen.findByRole('heading', { name: 'Purchase orders list' })).toBeInTheDocument();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(document.body).toHaveClass('table-compact');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('releases the app shell after a settings failure while keeping the browser theme', async () => {
    setAppearance({ theme: 'dark' });
    mocks.get.mockRejectedValue(new Error('Settings unavailable'));
    render(<MemoryRouter initialEntries={['/purchase-orders']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Purchase orders list' })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('does not fetch protected preferences while authentication is loading', () => {
    mocks.auth.loading = true;
    render(<MemoryRouter initialEntries={['/purchase-orders']}><App /></MemoryRouter>);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('shows login without a protected settings request for an unauthenticated visitor', async () => {
    mocks.auth.user = null;
    render(<MemoryRouter initialEntries={['/purchase-orders']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });
});

describe('system theme changes on public routes', () => {
  it.each(['system', 'light', 'dark'] as const)('reapplies %s on OS changes and removes the listener on unmount', async (theme) => {
    mocks.auth.user = null;
    let systemDark = false;
    const events = new EventTarget();
    const addEventListener = vi.fn(events.addEventListener.bind(events));
    const removeEventListener = vi.fn(events.removeEventListener.bind(events));
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
      get matches() { return systemDark; },
      addEventListener, removeEventListener,
    }) as unknown as MediaQueryList);
    setAppearance({ theme });
    const { unmount } = render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    act(() => { systemDark = true; events.dispatchEvent(new Event('change')); });
    expect(document.documentElement.classList.contains('dark')).toBe(theme !== 'light');
    expect(document.documentElement.style.colorScheme).toBe(theme === 'light' ? 'light' : 'dark');

    act(() => { systemDark = false; events.dispatchEvent(new Event('change')); });
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    const listener = addEventListener.mock.calls[0]![1];
    unmount();
    expect(removeEventListener).toHaveBeenCalledExactlyOnceWith('change', listener);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('reads the latest browser choice when the OS preference changes', async () => {
    mocks.auth.user = null;
    let systemDark = false;
    const events = new EventTarget();
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
      get matches() { return systemDark; },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    }) as unknown as MediaQueryList);
    setAppearance({ theme: 'system' });
    render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    act(() => {
      setAppearance({ theme: 'light' });
      systemDark = true;
      events.dispatchEvent(new Event('change'));
    });

    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
