import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./auth', () => ({ useAuth: () => ({ user: { roles: ['ADMIN'] }, loading: false }) }));
vi.mock('./components/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/GlobalPreferencesApplier', async () => {
  const React = await import('react');
  return {
    GlobalPreferencesApplier: ({ onReady }: { onReady?: () => void }) => {
      React.useEffect(() => { onReady?.(); }, [onReady]);
      return null;
    },
  };
});
vi.mock('./config/features', () => ({ PROCUREMENT_ENABLED: true }));
vi.mock('./pages/PurchaseOrders', () => ({ PurchaseOrders: () => <h1>Purchase orders list</h1> }));
vi.mock('./pages/Locations', async () => {
  const { useLocation } = await import('react-router-dom');
  return { Locations: () => <h1>Locations {useLocation().search}</h1> };
});

const { App } = await import('./App');

describe('retired goods receipts route', () => {
  it.each(['/goods-receipts', '/goods-receipts/GR-2026-0001'])('redirects %s to the purchase orders list', async (path) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Purchase orders list' })).toBeInTheDocument();
  });
});

describe('retired racks route', () => {
  it('opens Locations filtered to racks', async () => {
    render(<MemoryRouter initialEntries={['/racks']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Locations ?type=RACK' })).toBeInTheDocument();
  });
});
