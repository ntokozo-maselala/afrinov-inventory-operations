import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageContainer } from '../components/PageContainer';
import { ToastProvider } from '../components/Toast';
import { Settings } from './Settings';

const { mockGet, auth } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  auth: { roles: ['ADMIN'] as string[] },
}));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <ToastProvider>
        <PageContainer>
          <Routes>
            <Route path="/settings" element={<Settings />}>
              <Route index element={<section aria-label="General preferences"><button>General action</button></section>} />
              <Route path="appearance" element={<section aria-label="Appearance preferences"><button>Theme action</button></section>} />
            </Route>
          </Routes>
        </PageContainer>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Settings main landmark', () => {
  beforeEach(() => {
    auth.roles = ['ADMIN'];
    mockGet.mockReset().mockResolvedValue([]);
  });

  it.each(['ADMIN', 'VIEWER'])('keeps section content and navigation in the page main for %s', async (role) => {
    auth.roles = [role];
    const user = userEvent.setup();
    renderSettings();

    const general = await screen.findByRole('region', { name: 'General preferences' });
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toContainElement(general);
    expect(within(main).getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const navigation = within(main).getByRole('navigation', { name: 'Settings' });

    await user.click(within(navigation).getByRole('link', { name: /Appearance/ }));
    const appearance = await screen.findByRole('region', { name: 'Appearance preferences' });
    expect(screen.getAllByRole('main')).toEqual([main]);
    expect(main).toContainElement(appearance);
    expect(screen.queryByRole('region', { name: 'General preferences' })).not.toBeInTheDocument();
  });

  it('keeps a single main landmark while settings are loading', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderSettings();

    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(within(main).getByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'General preferences' })).not.toBeInTheDocument();
  });

  it('keeps the error message and retry control inside the single main landmark after a load failure', async () => {
    mockGet.mockRejectedValue({ code: 'INTERNAL_ERROR', message: 'Settings could not be loaded.' });
    renderSettings();

    const error = await screen.findByText('Settings could not be loaded.');
    const main = screen.getByRole('main');
    expect(main).toContainElement(error);
    expect(within(main).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(main).toContainElement(await screen.findByRole('region', { name: 'General preferences' }));
  });
});
