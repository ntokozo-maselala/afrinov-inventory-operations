// Write-offs over the limit wait for someone other than whoever asked for them:
// an approver approves, rejects or sends back another person's, and whoever
// asked may withdraw their own, or change one sent back and send it again.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { id: 'u-thandi', roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: auth.id, roles: auth.roles } }) }));

const { WriteOffApprovals, decidedText } = await import('./WriteOffApprovals');
const { writeOffsSentBackCard } = await import('./Dashboard');
const { ToastProvider } = await import('../components/Toast');

const request = (id: string, by: { id: string; name: string }, extra: Record<string, unknown> = {}) => ({
  id, status: 'PENDING', quantity: '-8', reasonCode: 'LOSS', reasonNote: 'Missing after the weekend', value: '2000.00', heldForProject: null,
  requestedAt: '2026-11-03T08:00:00.000Z', decidedAt: null, decisionNote: null, cursor: `2026-11-03T08:00:00.000Z_${id}`, daysWaiting: 9,
  material: { id: 'm-1', sku: 'CBL-1', name: 'Cable 4mm', unitOfMeasure: 'm' }, location: { id: 'l-1', name: 'Main store' },
  recipient: null, requestedBy: by, decidedBy: null, ...extra,
});
const SIPHO = { id: 'u-sipho', name: 'Sipho Dlamini' };
const THANDI = { id: 'u-thandi', name: 'Thandi Nkosi' };
const event = (kind: string, actor: { id: string; name: string }, quantity: string, note: string | null = null) => ({
  id: `${kind}-${quantity}`, kind, at: '2026-11-04T08:00:00.000Z', actor, note, quantity, reasonCode: 'LOSS', reasonNote: 'Missing after the weekend', value: null,
});

let lists: Record<string, unknown[]>;
let summary: Record<string, unknown>;
const listCalls = () => mockGet.mock.calls.map((c) => c[0] as string).filter((url) => url.startsWith('/adjustment-requests?'));

function renderPage() {
  render(<MemoryRouter><ToastProvider><WriteOffApprovals /></ToastProvider></MemoryRouter>);
}

beforeEach(() => {
  auth.id = 'u-thandi';
  auth.roles = ['STORE_CONTROLLER'];
  lists = { PENDING: [request('r-1', SIPHO), request('r-2', THANDI, { quantity: '30', reasonCode: 'OTHER', value: null })] };
  summary = { waiting: 2, oldestDays: 9, sentBackToMe: 0, rejectedForMe: 0 };
  mockGet.mockReset().mockImplementation(async (url: string) => {
    if (url === '/adjustment-requests/summary') return summary;
    if (url === '/units-of-measure') return [{ code: 'm', name: 'metre', kind: 'MEASURED' }];
    return lists[/status=(\w+)/.exec(url)?.[1] ?? ''] ?? [];
  });
  mockPost.mockReset().mockResolvedValue({ id: 'r-1', transactionId: 't-1' });
});

describe('Write-offs to approve', () => {
  it('lists what is waiting, with its value, and offers approval only on someone else\'s', async () => {
    renderPage();
    const sipho = (await screen.findByText('by Sipho Dlamini')).closest('tr')!;
    // A page at a time, each saying how long it has waited (system audit C8).
    expect(listCalls()[0]).toBe('/adjustment-requests?status=PENDING&limit=50');
    expect(within(sipho).getByText('Waiting 9 days')).toBeInTheDocument();
    expect(within(sipho).getByText('−8 m')).toBeInTheDocument();
    expect(within(sipho).getByText(/R\s2\s000,00/)).toBeInTheDocument();
    expect(within(sipho).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(sipho).getByRole('button', { name: 'Request changes' })).toBeInTheDocument();

    const own = screen.getByText('by Thandi Nkosi').closest('tr')!;
    expect(within(own).getByText('+30 m')).toBeInTheDocument();
    expect(within(own).getByText('No unit cost')).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument();
    expect(within(own).getByText('Waiting for someone else')).toBeInTheDocument();
  });

  it('approves after saying what will be posted', async () => {
    renderPage();
    const sipho = (await screen.findByText('by Sipho Dlamini')).closest('tr')!;
    fireEvent.click(within(sipho).getByRole('button', { name: 'Approve' }));
    expect(screen.getAllByText(/It posts −8 m of CBL-1 at Main store, worth R\s2\s000,00, booked to Sipho Dlamini\./).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and post' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/adjustment-requests/r-1/approve', undefined, expect.objectContaining({ idempotencyKey: expect.any(String) })));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
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

  // ADR-044 (FR-INV-WF-001).
  it('sends another person\'s back for changes, saying what to change', async () => {
    renderPage();
    const sipho = (await screen.findByText('by Sipho Dlamini')).closest('tr')!;
    fireEvent.click(within(sipho).getByRole('button', { name: 'Request changes' }));
    expect(screen.getByRole('heading', { name: 'Send this adjustment back for changes?' })).toBeInTheDocument();
    expect(screen.getByText(/Sipho Dlamini can change it and send it again\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    expect(await screen.findByText('Say what needs to change.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/What needs to change/), { target: { value: 'Recount the bin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/adjustment-requests/r-1/request-changes', { reason: 'Recount the bin' }, expect.anything()));
  });

  it('tells whoever asked that theirs came back, and sends the changed one again', async () => {
    summary = { waiting: 0, oldestDays: null, sentBackToMe: 1, rejectedForMe: 2 };
    lists = {
      PENDING: [],
      CHANGES_REQUESTED: [request('r-3', THANDI, {
        status: 'CHANGES_REQUESTED', decidedBy: SIPHO, decidedAt: '2026-11-04T08:00:00.000Z', decisionNote: 'Recount the bin: I make it 4 missing', amendable: 'ALL',
        events: [event('SUBMITTED', THANDI, '-8'), event('CHANGES_REQUESTED', SIPHO, '-8', 'Recount the bin: I make it 4 missing')],
      })],
    };
    renderPage();
    expect(await screen.findByText('1 of your adjustments was sent back to you for changes')).toBeInTheDocument();
    expect(screen.getByText('2 of your adjustments were rejected in the last 7 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show it' }));
    const row = (await screen.findByText('“Recount the bin: I make it 4 missing”')).closest('tr')!;
    expect(listCalls().at(-1)).toBe('/adjustment-requests?status=CHANGES_REQUESTED&limit=50');

    // Its history: each step, with the request as it stood.
    fireEvent.click(within(row).getByRole('button', { name: 'History of CBL-1' }));
    expect(screen.getByText('Asked for by Thandi Nkosi')).toBeInTheDocument();
    expect(screen.getByText('Sent back for changes by Sipho Dlamini')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(within(row).getByRole('button', { name: 'Change and send again' }));
    expect(screen.getByText('Sipho Dlamini asked for changes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Quantity to remove/), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/What you changed/), { target: { value: 'Recounted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/adjustment-requests/r-3/resubmit', { quantity: -4, comment: 'Recounted' }, expect.objectContaining({ idempotencyKey: expect.any(String) })));
  });

  it('lets only the note of a count difference sent back be changed', async () => {
    lists = {
      PENDING: [],
      CHANGES_REQUESTED: [request('r-4', THANDI, {
        status: 'CHANGES_REQUESTED', reasonCode: 'COUNT_VARIANCE', reasonNote: 'Stock count', decidedBy: SIPHO, decisionNote: 'Who counted?', amendable: 'NOTE',
      })],
    };
    renderPage();
    fireEvent.change(await screen.findByLabelText('Show'), { target: { value: 'CHANGES_REQUESTED' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Change and send again' }));
    expect(screen.queryByLabelText(/Quantity to remove/)).not.toBeInTheDocument();
    expect(screen.getByText(/comes from a stock count, so only the note can be changed here/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'Stock count: Thandi and Sipho' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/adjustment-requests/r-4/resubmit', { reasonNote: 'Stock count: Thandi and Sipho' }, expect.anything()));
  });

  // A withdrawal is never shown as a rejection by whoever withdrew it.
  it('says who withdrew a request, apart from who rejected one', async () => {
    const steps = [event('SUBMITTED', THANDI, '-8'), event('CHANGES_REQUESTED', SIPHO, '-8', 'Recount the bin'), event('WITHDRAWN', THANDI, '-8', 'Will count again')];
    lists = {
      PENDING: [],
      WITHDRAWN: [request('r-5', THANDI, { status: 'WITHDRAWN', decidedBy: THANDI, decidedAt: '2026-11-05T08:00:00.000Z', decisionNote: 'Will count again', events: steps })],
      REJECTED: [request('r-6', THANDI, { status: 'REJECTED', decidedBy: SIPHO, decidedAt: '2026-11-05T08:00:00.000Z', decisionNote: 'Count it first' })],
    };
    renderPage();
    fireEvent.change(await screen.findByLabelText('Show'), { target: { value: 'WITHDRAWN' } });
    const row = (await screen.findByText('Withdrawn by Thandi Nkosi')).closest('tr')!;
    expect(listCalls().at(-1)).toBe('/adjustment-requests?status=WITHDRAWN&limit=50');
    expect(within(row).getByText('Will count again')).toBeInTheDocument();
    expect(screen.queryByText(/Rejected by/)).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'History of CBL-1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Asked for by Thandi Nkosi')).toBeInTheDocument();
    expect(within(dialog).getByText('Sent back for changes by Sipho Dlamini')).toBeInTheDocument();
    expect(within(dialog).getByText('Withdrawn by Thandi Nkosi')).toBeInTheDocument();
    expect(within(dialog).getByText('“Will count again”')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Rejected by/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'REJECTED' } });
    expect(await screen.findByText('Rejected by Sipho Dlamini')).toBeInTheDocument();
  });

  it('reads a withdrawal stored as a rejection by whoever asked as a withdrawal', () => {
    const old = request('r-7', THANDI, { status: 'REJECTED', decidedBy: THANDI }) as unknown as Parameters<typeof decidedText>[0];
    expect(decidedText(old)).toBe('Withdrawn by Thandi Nkosi');
    expect(decidedText({ ...old, decidedBy: SIPHO })).toBe('Rejected by Sipho Dlamini');
    expect(decidedText({ ...old, status: 'APPROVED', decidedBy: SIPHO })).toBe('Approved by Sipho Dlamini');
  });

  // ADR-045: a tool lost on loan, sent back, takes a new quantity but keeps its reason and borrower.
  it('lets whoever asked change how many tools were lost, and nothing else but the note', async () => {
    lists = {
      CHANGES_REQUESTED: [request('r-8', THANDI, {
        status: 'CHANGES_REQUESTED', quantity: '-2', reasonCode: 'LOSS', reasonNote: 'Lost while checked out to Bukho: left on site',
        recipient: { id: 'rec-1', name: 'Bukho' }, referenceType: 'ToolLoan', amendable: 'QUANTITY',
        material: { id: 'm-2', sku: 'TL-0002', name: 'Hand drill', unitOfMeasure: 'each' }, decidedBy: SIPHO, decisionNote: 'Are both gone?',
      })],
    };
    render(<MemoryRouter initialEntries={['/stock/write-offs?status=CHANGES_REQUESTED']}><ToastProvider><WriteOffApprovals /></ToastProvider></MemoryRouter>);
    const row = (await screen.findByText('Tool lost on loan')).closest('tr')!;
    expect(listCalls()[0]).toBe('/adjustment-requests?status=CHANGES_REQUESTED&limit=50');
    fireEvent.click(within(row).getByRole('button', { name: 'Change and send again' }));
    expect(screen.queryByLabelText(/What happened/)).not.toBeInTheDocument();
    expect(screen.getByText(/Lost while checked out to Bukho\. The tool stays on loan until this is approved/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/How many were lost/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/What you changed/), { target: { value: 'One turned up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/adjustment-requests/r-8/resubmit', { quantity: -1, comment: 'One turned up' }, expect.anything()));
  });

  it('shows approval and its posting as separate steps, and tells whoever asked it was approved', async () => {
    summary = { waiting: 0, oldestDays: null, sentBackToMe: 0, rejectedForMe: 0, approvedForMe: 1 };
    lists = {
      PENDING: [],
      APPROVED: [request('r-9', THANDI, {
        status: 'APPROVED', decidedBy: SIPHO, decidedAt: '2026-11-05T08:00:00.000Z', referenceType: 'ToolRepair',
        events: [event('SUBMITTED', THANDI, '-8'), event('APPROVED', SIPHO, '-8'), { ...event('COMPLETED', SIPHO, '-8', 'Posted: the tool written off, and its repair closed.'), transactionId: 't-9' }],
      })],
    };
    renderPage();
    expect(await screen.findByText('1 of your adjustments was approved in the last 7 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show it' }));
    const row = (await screen.findByText('Approved by Sipho Dlamini')).closest('tr')!;
    expect(within(row).getByText('Tool held for repair')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'History of CBL-1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Approved by Sipho Dlamini')).toBeInTheDocument();
    expect(within(dialog).getByText('Completed by Sipho Dlamini')).toBeInTheDocument();
    expect(within(dialog).getByText('“Posted: the tool written off, and its repair closed.”')).toBeInTheDocument();
  });

  it('puts what was sent back to you on the Dashboard', () => {
    expect(writeOffsSentBackCard({ sentBackToMe: 0 })).toBeNull();
    expect(writeOffsSentBackCard({ sentBackToMe: 2 })).toMatchObject({ label: 'Sent back to you', value: '2', tone: 'warning', to: '/stock/write-offs' });
  });
});
