// Settings that do nothing (requirements gap, 11 Nov 2026): every setting on
// the page has an effect, or it isn't there. Seven that nothing read were
// retired (the system description, date and time formats, rows per page and
// the three notification switches); the session timeout is now enforced (ADR-035).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  isSafeServerMessage: () => true,
  FRONTEND_ONLY: false,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['ADMIN'] } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { Settings } = await import('./Settings');
const { SettingsGeneral, SettingsSecurity } = await import('./SettingsSections');
const { SettingsProvider, useSettings } = await import('../hooks/useSettings');
const { ToastProvider } = await import('../components/Toast');

const row = (key: string, value: unknown, type: string, category: string, description: string, enumOptions: string[] | null = null) => ({
  key, value, type, category, description, isEditable: true, enumOptions, updatedAt: '2026-11-11T00:00:00Z', updatedById: null,
});
// What the server lists now: the retired keys are gone.
const SETTINGS = [
  row('general.companyName', 'Afrinov', 'string', 'general', 'Company or organisation name shown across the application.'),
  row('general.defaultCurrency', 'ZAR', 'enum', 'general', 'Default currency for monetary values.', ['ZAR', 'USD']),
  row('general.defaultLandingPage', 'by-role', 'enum', 'general', 'Where to go after sign-in.', ['by-role', 'dashboard']),
  row('security.sessionTimeoutMinutes', 60, 'number', 'security', 'Minutes without activity before someone is signed out. A minute before, the screen offers to keep them signed in. A sign-in also ends 12 hours after it began, however active.'),
];

function Loaded({ children }: { children: React.ReactNode }) {
  return useSettings().loading ? null : <>{children}</>;
}
function section(node: React.ReactNode) {
  render(<MemoryRouter><ToastProvider><SettingsProvider canEdit><Loaded>{node}</Loaded></SettingsProvider></ToastProvider></MemoryRouter>);
}

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => (path === '/settings' ? SETTINGS : []));
});

describe('Settings → General', () => {
  it('shows only settings with an effect, and no longer reaches for the retired ones', async () => {
    section(<SettingsGeneral />);
    expect(await screen.findByLabelText('Company Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Default Currency')).toBeInTheDocument();
    expect(screen.getByLabelText('Default Landing Page')).toBeInTheDocument();
    for (const gone of [/System Description/i, /Date Format/i, /Time Format/i, /Page Size/i, /rows per page/i]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/page-size|locale/i)).not.toBeInTheDocument();
  });
});

describe('Settings → Security', () => {
  it('says what the session timeout does, and no longer that it cannot be enforced', async () => {
    section(<SettingsSecurity />);
    expect(await screen.findByLabelText('security.sessionTimeoutMinutes')).toHaveValue(60);
    expect(screen.getByText(/Minutes without activity before someone is signed out/)).toBeInTheDocument();
    expect(screen.queryByText(/12-hour JWT lifetime/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not yet wired/)).not.toBeInTheDocument();
    expect(screen.getByText(/checked by the server on every request/i)).toBeInTheDocument();
  });
});

describe('Settings navigation', () => {
  it('has no Notifications section, as nothing sends notifications', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <ToastProvider>
          <Routes>
            <Route path="/settings" element={<Settings />}>
              <Route index element={<p>General</p>} />
            </Route>
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: /Security/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Notifications/ })).not.toBeInTheDocument();
  });
});
