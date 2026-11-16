// ADR-043: project material waits for the Workshop Manager, or the Director
// standing in. They approve, possibly for less, or reject; the storeman who
// asked may only cancel their own.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { id: 'u-wm', roles: ['WORKSHOP_MANAGER'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: auth.id, roles: auth.roles } }) }));

const { IssueApprovals } = await import('./IssueApprovals');
const { ToastProvider } = await import('../components/Toast');

const SIPHO = { id: 'u-sipho', name: 'Sipho Dlamini' };
const request = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projectNumber: 'AFRI-1325', projectName: 'Plant upgrade', recipient: { id: 'r-1', name: 'Bongani', type: 'WORKER' }, note: null,
  status: 'PENDING', requestedBy: SIPHO, requestedAt: '2026-11-16T08:00:00.000Z', decidedBy: null, decidedAt: null, decisionNote: null,
  standIn: false, issueId: null, cursor: `2026-11-16T08:00:00.000Z_${id}`, daysWaiting: 0,
  lines: [
    { id: 'l-1', lineNo: 1, material: { id: 'm-1', sku: 'PL-10', name: 'Plate 10mm', unitOfMeasure: 'each' }, location: { id: 'loc-1', name: 'Bay 2' }, quantity: '4', approvedQuantity: null, onHand: '10' },
    { id: 'l-2', lineNo: 2, material: { id: 'm-2', sku: 'BO-12', name: 'Bolt M12', unitOfMeasure: 'each' }, location: { id: 'loc-1', name: 'Bay 2' }, quantity: '6', approvedQuantity: null, onHand: '6' },
  ],
  ...extra,
});

function renderPage() {
  render(<MemoryRouter><ToastProvider><IssueApprovals /></ToastProvider></MemoryRouter>);
}

beforeEach(() => {
  auth.id = 'u-wm';
  auth.roles = ['WORKSHOP_MANAGER'];
  mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/issue-requests') ? [request('ir-1')] : []));
  mockPost.mockReset().mockResolvedValue({ id: 'ir-1', issueId: 'iss-1', transactionIds: ['t-1'] });
});

describe('Issues to approve', () => {
  it('lists what waits, with what is held for the project now', async () => {
    renderPage();
    const row = (await screen.findAllByText('To Bongani'))[0]!.closest('tr')!;
    expect(mockGet.mock.calls.some(([p]) => p === '/issue-requests?status=PENDING&limit=50')).toBe(true);
    expect(within(row).getByText('Waiting since today')).toBeInTheDocument();
    expect(within(row).getByText(/Bay 2 · 10 each held for the project now/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('approves less than was asked, leaving a line out with 0', async () => {
    renderPage();
    const row = (await screen.findAllByText('To Bongani'))[0]!.closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this issue?' });
    expect(within(dialog).getByText(/Your approval stands as the slip’s confirmation/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/PL-10/), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText(/BO-12/), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and issue' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/issue-requests/ir-1/approve', {
      lines: [{ lineId: 'l-1', quantity: 3 }, { lineId: 'l-2', quantity: 0 }],
    }, expect.any(Object)));
  });

  it('refuses more than was asked, or nothing at all, before sending', async () => {
    renderPage();
    fireEvent.click(within((await screen.findAllByText('To Bongani'))[0]!.closest('tr')!).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this issue?' });
    fireEvent.change(within(dialog).getByLabelText(/PL-10/), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and issue' }));
    expect(await within(dialog).findByText(/Line 1: approve at most the 4 each asked for/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/PL-10/), { target: { value: '0' } });
    fireEvent.change(within(dialog).getByLabelText(/BO-12/), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and issue' }));
    expect(await within(dialog).findByText('Approve at least one line, or reject the request.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rejects only with a reason', async () => {
    renderPage();
    fireEvent.click(within((await screen.findAllByText('To Bongani'))[0]!.closest('tr')!).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject this issue?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('Say why.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: 'Use the offcuts first' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/issue-requests/ir-1/reject', { reason: 'Use the offcuts first' }, expect.any(Object)));
  });

  it('lets the storeman who asked only cancel their own', async () => {
    auth.id = 'u-sipho';
    auth.roles = ['STORE_CONTROLLER'];
    renderPage();
    const row = (await screen.findAllByText('To Bongani'))[0]!.closest('tr')!;
    expect(within(row).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this request?' });
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: 'Wrong recipient' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/issue-requests/ir-1/cancel', { reason: 'Wrong recipient' }, expect.any(Object)));
  });

  it('offers an Admin who is neither Workshop Manager nor Director no approval, as the server refuses it', async () => {
    auth.roles = ['ADMIN'];
    renderPage();
    const row = (await screen.findAllByText('To Bongani'))[0]!.closest('tr')!;
    expect(within(row).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(row).getByText('Waiting for the Workshop Manager')).toBeInTheDocument();
  });

  it('shows who decided, and when the Director stood in', async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/issue-requests') ? [request('ir-2', {
      status: 'APPROVED', decidedBy: { id: 'u-dir', name: 'Lindiwe Zulu' }, decidedAt: '2026-11-16T10:00:00.000Z', standIn: true, issueId: 'iss-2',
      lines: [{ ...request('x').lines[0], approvedQuantity: '3', onHand: null }],
    })] : []));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Show'), { target: { value: 'APPROVED' } });
    expect(await screen.findAllByText(/Lindiwe Zulu \(Director, standing in\)/)).not.toHaveLength(0);
    expect(screen.getAllByText(/approved 3 each/).length).toBeGreaterThan(0);
  });
});
