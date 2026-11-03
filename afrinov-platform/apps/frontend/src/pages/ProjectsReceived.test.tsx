// The Projects page lists project material received and not yet issued
// (Project Material Through the Store Roadmap, Phase 4), and says when that
// list couldn't load rather than showing nothing waiting (Qodo, PR #146).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['STORE_CONTROLLER'] } }) }));

const { Projects } = await import('./Projects');
const { ToastProvider } = await import('../components/Toast');

const PROJECT = { projectNumber: 'AFRI-1402', name: 'Door rails', status: 'ACTIVE', active: true, createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z' };
const page = () => render(<MemoryRouter><ToastProvider><Projects /></ToastProvider></MemoryRouter>);

describe('Projects: received for projects, not yet issued', () => {
  it('lists what is waiting to be issued, by project', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/reports/current-stock')) return [{
        materialId: 'm-1', materialSku: 'BEAM', materialName: 'Beam', category: 'PROJECT_MATERIAL', locationId: 'l-1', locationName: 'Workshop floor',
        unitOfMeasure: 'each', quantity: '4', heldForProject: 'AFRI-1402',
      }];
      if (path.startsWith('/projects')) return [PROJECT];
      return [];
    });
    page();
    expect(await screen.findByText('Received for projects, not yet issued')).toBeInTheDocument();
    expect(screen.getByText(/Project AFRI-1402:/)).toHaveTextContent('Beam (4 each)');
  });

  it('says when that list could not be loaded', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/reports/current-stock')) throw { code: 'SERVICE_UNAVAILABLE', message: 'Try again shortly' };
      if (path.startsWith('/projects')) return [PROJECT];
      return [];
    });
    page();
    expect(await screen.findByText('Project material received and not yet issued couldn’t be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
