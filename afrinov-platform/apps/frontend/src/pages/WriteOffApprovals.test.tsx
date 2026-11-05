// Write-offs over the limit wait for someone other than whoever asked for them:
// an approver approves or rejects another person's, and whoever asked may only
// withdraw their own.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { id: 'u-thandi', roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: auth.id, roles: auth.roles } }) }));

const { WriteOffApprovals } = await import('./WriteOffApprovals');
const { ToastProvider } = await import('../components/Toast');

const request = (id: string, by: { id: string; name: string }, extra: Record<string, unknown> = {}) => ({
  id, status: 'PENDING', quantity: '-8', reasonCode: 'LOSS', reasonNote: 'Missing after the weekend', value: '2000.00', heldForProject: null,
  requestedAt: '2026-11-03T08:00:00.000Z', decidedAt: null, decisionNote: null,
  material: { id: 'm-1', sku: 'CBL-1', name: 'Cable 4mm', unitOfMeasure: 'm' }, location: { id: 'l-1', name: 'Main store' },
  recipient: null, requestedBy: by, decidedBy: null, ...extra,
});
const SIPHO = { id: 'u-sipho', name: 'Sipho Dlamini' };
const THANDI = { id: 'u-thandi', name: 'Thandi Nkosi' };

function renderPage() {
  render(<MemoryRouter><ToastProvider><WriteOffApprovals /></ToastProvider></MemoryRouter>);
}

beforeEach(() => {
  auth.id = 'u-thandi';
  auth.roles = ['STORE_CONTROLLER'];
  mockGet.mockReset().mockResolvedValue([request('r-1', SIPHO), request('r-2', THANDI, { quantity: '30', reasonCode: 'OTHER', value: null })]);
  mockPost.mockReset().mockResolvedValue({ id: 'r-1', transactionId: 't-1' });
});

describe('Write-offs to approve', () => {
  it('lists what is waiting, with its value, and offers approval only on someone else\'s', async () => {
    renderPage();
    const sipho = (await screen.findByText('by Sipho Dlamini')).closest('tr')!;
    expect(mockGet.mock.calls[0]![0]).toBe('/adjustment-requests?status=PENDING');
    expect(within(sipho).getByText('−8 m')).toBeInTheDocument();
    expect(within(sipho).getByText(/R\s2\s000,00/)).toBeInTheDocument();
    expect(within(sipho).getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    const own = screen.getByText('by Thandi Nkosi').closest('tr')!;
    expect(within(own).getByText('+30 m')).toBeInTheDocument();
    expect(within(own).getByText('No unit cost')).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(own).getByText('Waiting for someone else')).toBeInTheDocument();
  });

  it('approves after saying what will be posted', async () => {
    renderPage();
    const sipho = (await screen.findByText('by Sipho Dlamini')).closest('tr')!;
    fireEvent.click(within(sipho).getByRole('button', { name: 'Approve' }));
    expect(screen.getAllByText(/It posts −8 m of CBL-1 at Main store, worth R\s2\s000,00, booked to Sipho Dlamini\./).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and post' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/adjustment-requests/r-1/approve', undefined, expect.objectContaining({ idempotencyKey: expect.any(String) })));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('needs a reason to reject, and withdraws your own the same way', async () => {
    renderPage();
    const own = (await screen.findByText('by Thandi Nkosi')).closest('tr')!;
    fireEvent.click(within(own).getByRole('button', { name: 'Withdraw' }));
    expect(screen.getByRole('heading', { name: 'Withdraw this adjustment?' })).toBeInTheDocument();
    const dialog = screen.getByRole('heading', { name: 'Withdraw this adjustment?' }).closest('[role="dialog"]') as HTMLElement ?? document.body;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('Say why.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Why/), { target: { value: 'Booked on the wrong item' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/adjustment-requests/r-2/reject', { reason: 'Booked on the wrong item' }, expect.anything()));
  });

  it('shows someone who cannot approve that it is waiting, with no buttons', async () => {
    auth.id = 'u-viewer';
    auth.roles = ['TECHNICIAN'];
    renderPage();
    const sipho = (await screen.findByText('by Sipho Dlamini')).closest('tr')!;
    expect(within(sipho).queryByRole('button')).not.toBeInTheDocument();
    expect(within(sipho).getByText('Waiting for approval')).toBeInTheDocument();
  });
});
