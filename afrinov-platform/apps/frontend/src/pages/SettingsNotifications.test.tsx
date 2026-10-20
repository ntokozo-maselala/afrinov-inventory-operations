// Purchase order alerts are not offered under Settings → Notifications
// (procurement workflow Phase 7): nothing sends or shows them yet, so the
// setting would do nothing. Its key stays on the server.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  FRONTEND_ONLY: false,
}));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { SettingsNotifications } = await import('./SettingsSections');
const { SettingsProvider, useSettings } = await import('../hooks/useSettings');
const { ToastProvider } = await import('../components/Toast');

/** As the Settings page: a section shows once the settings have loaded. */
function WhenLoaded({ children }: { children: React.ReactNode }) {
  return useSettings().settings['notifications.enableInAppNotifications'] ? <>{children}</> : null;
}

const row = (key: string, description: string) => ({
  key, value: true, type: 'boolean', category: 'notifications', description, isEditable: true, enumOptions: null, updatedAt: '2026-01-01T00:00:00Z', updatedById: null,
});

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => (path === '/settings' ? [
    row('notifications.enableInAppNotifications', 'Show in-app notifications.'),
    row('notifications.enableLowStockNotifications', 'Alert when stock runs low.'),
    row('notifications.enablePurchaseOrderNotifications', 'Alert when purchase orders need approval or reach a new state.'),
  ] : []));
});

describe('Settings → Notifications', () => {
  it('does not offer purchase order alerts, which nothing sends yet', async () => {
    render(<MemoryRouter><ToastProvider><SettingsProvider canEdit><WhenLoaded><SettingsNotifications /></WhenLoaded></SettingsProvider></ToastProvider></MemoryRouter>);
    expect(await screen.findByText('Alert when stock runs low.')).toBeInTheDocument();
    expect(screen.queryByText('Alert when purchase orders need approval or reach a new state.')).not.toBeInTheDocument();
  });
});
