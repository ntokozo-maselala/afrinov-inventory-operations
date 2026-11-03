// Where project deliveries are booked (Project Material Through the Store
// Roadmap, Phase 4): project material isn't shelved, so an administrator names
// one location, such as the workshop floor, for Receive stock to use.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  FRONTEND_ONLY: false,
  isSafeServerMessage: () => true,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['ADMIN'] } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { SettingsProvider, useSettings } = await import('../hooks/useSettings');
const { SettingsInventory } = await import('./SettingsSections');
const { ToastProvider } = await import('../components/Toast');

/** As the Settings shell: a section shows once the settings have loaded. */
function Loaded() { return useSettings().loading ? null : <SettingsInventory />; }

const setting = (key: string, value: unknown, type = 'number', enumOptions: string[] | null = null) => ({
  key, value, type, category: 'inventory', description: `About ${key}`, isEditable: true, enumOptions, updatedAt: '', updatedById: null,
});
const SETTINGS = [
  setting('inventory.urgentBelowPercent', 20), setting('inventory.warningBelowPercent', 40),
  setting('inventory.defaultUnitOfMeasure', 'each', 'string'), setting('inventory.enableStockAlerts', true, 'boolean'),
  setting('inventory.toolOverdueDays', 7), setting('inventory.toolMaxLoanDays', 30), setting('inventory.toolEscalateDays', 14),
  setting('inventory.toolOverdueCheckout', 'warn', 'enum', ['warn', 'block-contractors', 'block']),
  setting('inventory.projectReceivingLocationId', 'loc-old', 'string'),
];

describe('Settings: project receiving location', () => {
  it('offers the active locations, keeps an inactive one already chosen, with no location as a choice', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/settings') return SETTINGS;
      if (path === '/locations') return [
        { id: 'loc-floor', name: 'Workshop floor', active: true },
        { id: 'loc-main', name: 'Main store', active: true },
        { id: 'loc-old', name: 'Old shed', active: false },
        { id: 'loc-gone', name: 'Closed bay', active: false },
      ];
      return [];
    });
    render(<MemoryRouter><ToastProvider><SettingsProvider canEdit><Loaded /></SettingsProvider></ToastProvider></MemoryRouter>);
    const field = await screen.findByLabelText('Project receiving location');
    await within(field).findByRole('option', { name: 'Workshop floor' });
    expect(within(field).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose on each delivery', 'Main store', 'Old shed (inactive)', 'Workshop floor',
    ]);
    expect(field).toHaveValue('loc-old');
  });
});
