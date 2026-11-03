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

  // Qodo, PR #146: each item says why Issue leaves it out, and a failed check
  // of the projects says Issue isn't offered, with a retry.
  it('says why Issue leaves an item out, beside what it takes', async () => {
    const row = (materialId: string, name: string, over: Record<string, unknown> = {}) => ({
      materialId, materialSku: name, materialName: name, category: 'PROJECT_MATERIAL', locationId: 'l-1', locationName: 'Workshop floor',
      unitOfMeasure: 'each', quantity: '4', heldForProject: 'AFRI-1402', ...over,
    });
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/reports/current-stock')) return [row('m-1', 'Beam'), row('m-2', 'Plate', { locationId: 'l-2', quantity: '1', locationActive: false }), row('m-2', 'Plate', { quantity: '2' })];
      if (path.startsWith('/projects')) return [PROJECT];
      return [];
    });
    page();
    expect(await screen.findByRole('link', { name: "Issue project AFRI-1402's material" })).toBeInTheDocument();
    expect(screen.getByText(/Project AFRI-1402:/)).toHaveTextContent('Beam (4 each), Plate (3 each; 1 each not issued: location not in use) · Issue');
  });

  it('says Issue isn\u2019t offered when the projects couldn\u2019t be checked', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/reports/current-stock')) return [{
        materialId: 'm-1', materialSku: 'BEAM', materialName: 'Beam', category: 'PROJECT_MATERIAL', locationId: 'l-1', locationName: 'Workshop floor',
        unitOfMeasure: 'each', quantity: '4', heldForProject: 'AFRI-1402',
      }];
      // The notice reads every project, archived ones too (Qodo, PR #149).
      if (path.startsWith('/projects')) throw { code: 'SERVICE_UNAVAILABLE', message: 'Try again shortly' };
      return [];
    });
    page();
    expect(await screen.findByText(/The projects couldn.t be checked, so Issue isn.t offered/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: "Issue project AFRI-1402's material" })).not.toBeInTheDocument();
  });

  // Qodo, PR #149: a completed project's stock moves to Stores even once the project is archived.
  it('links an archived completed project\'s stock to Move to Stores', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/reports/current-stock')) return [{
        materialId: 'm-1', materialSku: 'BEAM', materialName: 'Beam', category: 'PROJECT_MATERIAL', locationId: 'l-1', locationName: 'Workshop floor',
        unitOfMeasure: 'each', quantity: '4', heldForProject: 'AFRI-1402',
      }];
      if (path.startsWith('/projects')) return [{ ...PROJECT, status: 'COMPLETED', active: false }];
      return [];
    });
    page();
    expect(await screen.findByRole('link', { name: 'move to Stores' })).toHaveAttribute('href', '/projects/AFRI-1402/leftovers');
    expect(screen.queryByRole('link', { name: "Issue project AFRI-1402's material" })).not.toBeInTheDocument();
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
