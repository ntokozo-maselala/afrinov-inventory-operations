// The project form offers managers to choose from only to an Admin, the one
// role that may read the user list (manage:users). Sales, the store controller
// and Procurement set up projects too; they see the manager as it stands, not
// "Couldn't load users" from a list they may not read.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), auth: { roles: ['SALES'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'u-me', roles: auth.roles } }) }));

const { Projects } = await import('./Projects');
const { ToastProvider } = await import('../components/Toast');

const MANAGER = { id: 'u-pm', name: 'Thandi Mokoena', email: 'thandi@example.com' };
const PROJECT = {
  projectNumber: 'AFRI-0413', name: 'Hydraulic maintenance', status: 'PLANNING', active: true,
  managerId: MANAGER.id, manager: MANAGER, createdAt: '2026-11-13T08:00:00Z', updatedAt: '2026-11-13T08:00:00Z',
};

function serve(projects: unknown[]) {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/users')) return [MANAGER, { id: 'u-2', name: 'Sipho Dlamini', email: 's@example.com' }];
    if (path.startsWith('/projects')) return projects;
    return [];
  });
}
const usersRequested = () => mockGet.mock.calls.some(([p]) => String(p).startsWith('/users'));
const page = () => render(<MemoryRouter><ToastProvider><Projects /></ToastProvider></MemoryRouter>);

describe('Project form: the manager field', () => {
  it.each(['SALES', 'STORE_CONTROLLER', 'PROCUREMENT'])('%s adds a project without asking for the user list', async (role) => {
    auth.roles = [role];
    serve([]);
    page();
    await userEvent.click((await screen.findAllByRole('button', { name: /Add (your first )?project/ }))[0]!);

    const field = await screen.findByLabelText('Project manager');
    expect(field).toBeDisabled();
    expect(field).toHaveDisplayValue('Unassigned');
    expect(screen.getByText('An Admin assigns the project manager.')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t load users/)).not.toBeInTheDocument();
    expect(usersRequested()).toBe(false);
  });

  it('shows Sales the manager a project already has when editing it', async () => {
    auth.roles = ['SALES'];
    serve([PROJECT]);
    page();
    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));

    expect(await screen.findByLabelText('Project manager')).toHaveDisplayValue(MANAGER.name);
    expect(usersRequested()).toBe(false);
  });

  it('offers an Admin the users to choose from', async () => {
    auth.roles = ['ADMIN'];
    serve([]);
    page();
    await userEvent.click((await screen.findAllByRole('button', { name: /Add (your first )?project/ }))[0]!);

    const field = await screen.findByLabelText('Project manager');
    expect(field).toBeEnabled();
    expect(await screen.findByRole('option', { name: 'Sipho Dlamini' })).toBeInTheDocument();
    expect(usersRequested()).toBe(true);
  });
});
