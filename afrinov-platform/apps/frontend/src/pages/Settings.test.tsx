import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  FRONTEND_ONLY: false,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['ADMIN'] } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { Settings } = await import('./Settings');
const { PageContainer } = await import('../components/PageContainer');
const { ToastProvider } = await import('../components/Toast');

describe('Settings landmarks', () => {
  it('keeps the Settings content inside the app main landmark', async () => {
    mockGet.mockReset().mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <ToastProvider>
          <PageContainer>
            <Routes>
              <Route path="/settings" element={<Settings />}>
                <Route index element={<p>General settings content</p>} />
              </Route>
            </Routes>
          </PageContainer>
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
