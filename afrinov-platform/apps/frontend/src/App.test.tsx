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

// A stand-in Settings layout that records how many times it mounts, with two
// child tabs. Moving between the tabs must not remount the layout, or the
// unsaved draft held by its provider above the tab is lost.
let settingsMounts = 0;
vi.mock('./pages/Settings', async () => {
  const { useEffect } = await import('react');
  const { Outlet, Link } = await import('react-router-dom');
  return {
    Settings: () => {
      useEffect(() => { settingsMounts += 1; }, []);
      return (
        <div>
          <h1>Settings</h1>
          <Link to="/settings/inventory">Inventory tab</Link>
          <Link to="/settings">General tab</Link>
          <Outlet />
        </div>
      );
    },
  };
});
vi.mock('./pages/SettingsSections', () => ({
  SettingsGeneral: () => <h2>General</h2>,
  SettingsInventory: () => <h2>Inventory</h2>,
}));

const { App } = await import('./App');

describe('Settings tab navigation', () => {
  it('keeps the Settings layout mounted when moving between its tabs', async () => {
    settingsMounts = 0;
    const { fireEvent } = await import('@testing-library/react');
    render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
    const afterFirst = settingsMounts;

    fireEvent.click(screen.getByText('Inventory tab'));

    expect(await screen.findByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    expect(settingsMounts).toBe(afterFirst);
  });
});

describe('retired goods receipts route', () => {
  it.each(['/goods-receipts', '/goods-receipts/GR-2026-0001'])('redirects %s to the purchase orders list', async (path) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Purchase orders list' })).toBeInTheDocument();
  });
});

// Nothing sends notifications, so their switches were retired (11 Nov 2026).
describe('retired notifications settings route', () => {
  it('opens General settings', async () => {
    render(<MemoryRouter initialEntries={['/settings/notifications']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
  });
});

describe('retired racks route', () => {
  it('opens Locations filtered to racks', async () => {
    render(<MemoryRouter initialEntries={['/racks']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Locations ?type=RACK' })).toBeInTheDocument();
  });
});
