// Approval limits under Settings → Users & permissions (procurement roadmap
// Phase 4): set for users whose role may approve purchase orders.
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

const { SettingsUsers } = await import('./SettingsSections');
const { ToastProvider } = await import('../components/Toast');

const user = (id: string, name: string, role: string, approvalLimit: string | null = null) => ({
  id, name, email: `${id}@afrinov.local`, active: true, createdAt: '2026-01-01T00:00:00Z', roles: [{ role: { name: role } }], approvalLimit,
});
const USERS = [user('u-ona', 'Ona Moloane', 'APPROVER', '500000'), user('u-sb', 'Simbongile Bantubani', 'APPROVER'), user('u-st', 'Store Controller', 'STORE_CONTROLLER')];

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => (path === '/users' ? USERS : []));
  mockPost.mockReset().mockResolvedValue({ id: 'u-new' });
  mockPatch.mockReset().mockResolvedValue({});
});

const page = () => render(<MemoryRouter><ToastProvider><SettingsUsers /></ToastProvider></MemoryRouter>);
const row = (name: string) => screen.getByText(name).closest('li, tr, div.surface-card, [class*="border"]') as HTMLElement;

describe('approval limits', () => {
  it('shows what each approver may approve', async () => {
    page();
    await screen.findByText('Ona Moloane');
    expect(screen.getByText(/Approves orders up to R\s500\s000,00/)).toBeInTheDocument();
    expect(screen.getByText('Approves orders of any value')).toBeInTheDocument();
    expect(screen.getAllByText(/Approves orders/)).toHaveLength(2);
    // The store controller approves the store's stock orders (Stores and Procurement Separation Roadmap).
    expect(within(row('Store Controller')).getByText('Approves stock orders of any value')).toBeInTheDocument();
  });

  it('sets a limit on an approver; blank means no limit', async () => {
    page();
    await screen.findByText('Ona Moloane');
    fireEvent.click(within(row('Ona Moloane')).getByRole('button', { name: 'Edit' }));
    const field = await screen.findByLabelText('Approval limit (R, including VAT)');
    expect(field).toHaveValue(500000);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save user' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/users/u-ona', expect.objectContaining({ approvalLimit: null })));
  });

  it('asks only for roles that approve, and sets it on a new user in a second step', async () => {
    page();
    await screen.findByText('Ona Moloane');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add user' })[0]!);
    expect(screen.queryByLabelText('Approval limit (R, including VAT)')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'New Approver' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'new@afrinov.local' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret-passphrase-123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: 'secret-passphrase-123' } });
    const drawer = screen.getByRole('dialog');
    fireEvent.click(within(drawer).getByRole('checkbox', { name: /^Approver/ }));
    fireEvent.change(screen.getByLabelText('Approval limit (R, including VAT)'), { target: { value: '250000' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/users/u-new', { approvalLimit: 250000 }));
  });
});
