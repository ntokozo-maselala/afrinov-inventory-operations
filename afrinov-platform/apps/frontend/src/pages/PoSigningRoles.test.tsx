// The roles that sign purchase orders, under Settings → Users & permissions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost, mockPatch } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  FRONTEND_ONLY: false,
}));
// Procurement is a build-time switch; on here so the test reads the same everywhere.
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));
// Signed in as the store controller listed below, so their own row is the one without account actions.
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'u-st', name: 'Store Controller', roles: ['ADMIN'] } }) }));

const { SettingsUsers, approvalLine } = await import('./SettingsSections');
const { ToastProvider } = await import('../components/Toast');

const user = (id: string, name: string, ...roles: string[]) => ({
  id, name, email: `${id}@afrinov.local`, active: true, createdAt: '2026-01-01T00:00:00Z', roles: roles.map((role) => ({ role: { name: role } })),
});
const USERS = [user('u-ona', 'Ona Moloane', 'PROCUREMENT_MANAGER'), user('u-sb', 'Simbongile Bantubani', 'DIRECTOR'), user('u-st', 'Store Controller', 'STORE_CONTROLLER')];

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => (path === '/users' ? USERS : []));
  mockPost.mockReset().mockResolvedValue({ id: 'u-new' });
  mockPatch.mockReset().mockResolvedValue({});
});

const page = () => render(<MemoryRouter><ToastProvider><SettingsUsers /></ToastProvider></MemoryRouter>);
const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('signing roles', () => {
  it('says what each role signs, and nothing for those who sign nothing', () => {
    expect(approvalLine(['PROCUREMENT_MANAGER'])).toBe('Signs every order first');
    expect(approvalLine(['DIRECTOR'])).toBe('Signs large project orders');
    expect(approvalLine(['CEO'])).toBe('Stands in on project orders');
    expect(approvalLine(['WORKSHOP_MANAGER'])).toBe('Stands in on project and stock orders');
    for (const role of ['ADMIN', 'APPROVER', 'STORE_CONTROLLER', 'PROCUREMENT']) expect(approvalLine([role])).toBeNull();
  });

  it('shows it on each user, with no approval limit to set', async () => {
    page();
    await screen.findByText('Ona Moloane');
    expect(within(row('Ona Moloane')).getByText('Signs every order first')).toBeInTheDocument();
    expect(within(row('Store Controller')).queryByText(/Signs|Stands in/)).not.toBeInTheDocument();
    fireEvent.click(within(row('Ona Moloane')).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('button', { name: 'Save user' });
    expect(screen.queryByLabelText(/Approval limit/)).not.toBeInTheDocument();
  });

  // ADR-036 and system audit F2: your own password is changed from the header, and nobody deactivates themselves.
  it('offers a temporary password and deactivation on other rows, not your own', async () => {
    page();
    await screen.findByText('Ona Moloane');
    expect(within(row('Ona Moloane')).getByRole('button', { name: 'Temporary password' })).toBeInTheDocument();
    expect(within(row('Ona Moloane')).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(within(row('Store Controller')).getByText('You')).toBeInTheDocument();
    expect(within(row('Store Controller')).queryByRole('button', { name: 'Temporary password' })).not.toBeInTheDocument();
    expect(within(row('Store Controller')).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('sets a temporary password for someone else', async () => {
    page();
    await screen.findByText('Ona Moloane');
    fireEvent.click(within(row('Ona Moloane')).getByRole('button', { name: 'Temporary password' }));
    fireEvent.change(document.getElementById('tmp-pw')!, { target: { value: 'Temp-pass-2026' } });
    fireEvent.change(document.getElementById('tmp-pw2')!, { target: { value: 'Temp-pass-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set temporary password' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/users/u-ona/password', { temporaryPassword: 'Temp-pass-2026' }));
  });

  it('assigns a signing role to a new user', async () => {
    page();
    await screen.findByText('Ona Moloane');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add user' })[0]!);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'New Director' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'new@afrinov.local' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: 'secret123' } });
    const drawer = screen.getByRole('dialog');
    fireEvent.click(within(drawer).getByRole('checkbox', { name: /^Director/ }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/users', expect.objectContaining({ roleNames: ['VIEWER', 'DIRECTOR'] })));
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
