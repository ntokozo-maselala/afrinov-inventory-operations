import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

// Signed in as a store controller, who may do everything on these pages; tests that need another role set signedIn.roles.
const { signedIn } = vi.hoisted(() => ({ signedIn: { roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: signedIn.roles } }) }));

const { ReturnStock } = await import('./ReturnStock');
const { ToastProvider } = await import('../components/Toast');

const line = (id: string, name: string, outstanding: string, over: Record<string, unknown> = {}) => ({
  issueTransactionId: id, issueId: `slip-${id}`, postedAt: '2026-10-10T08:00:00.000Z', materialId: `m-${id}`,
  sku: `SKU-${id}`, name, unitOfMeasure: 'each', locationId: 'l-1', locationName: 'A-1', locationActive: true,
  projectNumber: 'AFRI-1325', issued: outstanding, returned: '0', outstanding, ...over,
});

let returnable: unknown[];

function renderAt(url = '/stock/return') {
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/recipients')) return [{ id: 'r-1', name: 'Sabelo', type: 'WORKER' }, { id: 'r-2', name: 'Forklift', type: 'MACHINE' }];
    if (path.startsWith('/locations')) return [{ id: 'l-1', name: 'A-1', active: true }, { id: 'l-2', name: 'B-2', active: true }, { id: 'l-old', name: 'Old store', active: false }];
    if (path.startsWith('/inventory-returns/returnable')) return returnable;
    return [];
  });
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><ReturnStock /></ToastProvider></MemoryRouter>);
}

const returnableCalls = () => mockGet.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/inventory-returns/returnable'));
const qtyFor = (name: string) => screen.getByLabelText(new RegExp(`^Back on the shelf: ${name}`));
const usedFor = (name: string) => screen.getByLabelText(new RegExp(`^Used up: ${name}`));
const brokenFor = (name: string) => screen.getByLabelText(new RegExp(`^Broken: ${name}`));
// Return stock until something is typed, then Book N lines.
const bookButton = () => screen.getByRole('button', { name: /^(Return stock|Book \d+ lines?)$/ });
const intoFor = (name: string) => screen.getByLabelText(new RegExp(`^Back into: ${name}`));

describe('ReturnStock page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset().mockResolvedValue({ transactionIds: ['t-r1'] });
    returnable = [
      line('a', 'Cutting disc', '10', { returned: '2', issued: '12' }),
      line('b', 'Welding gloves', '4', { locationId: 'l-old', locationName: 'Old store', locationActive: false, projectNumber: null }),
    ];
  });

  it('lists nothing until someone is chosen', async () => {
    renderAt();
    await screen.findByRole('option', { name: 'Sabelo' });
    expect(returnableCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Return stock' })).toBeDisabled();
  });

  it("lists what the recipient in the address still has out over the last 30 days", async () => {
    renderAt('/stock/return?recipientId=r-1');
    expect(await screen.findByText('Cutting disc')).toBeInTheDocument();
    expect(screen.getByText('2 of 12 already back')).toBeInTheDocument();
    const call = returnableCalls()[0]!;
    expect(call).toMatch(/recipientId=r-1&from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/);
    const from = new URLSearchParams(call.split('?')[1]).get('from')!;
    const days = (Date.parse(new URLSearchParams(call.split('?')[1]).get('to')!) - Date.parse(from)) / 86_400_000;
    expect(days).toBe(30);
  });

  it('looks further back when the date is changed', async () => {
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.change(screen.getByLabelText(/Issued since/), { target: { value: '2026-01-01' } });
    await waitFor(() => expect(returnableCalls().at(-1)).toContain('from=2026-01-01'));
  });

  it('returns the lines filled in, in one booking, and only names a location that differs', async () => {
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.change(qtyFor('Cutting disc'), { target: { value: '3' } });
    fireEvent.change(qtyFor('Welding gloves'), { target: { value: '4' } });
    fireEvent.change(intoFor('Welding gloves'), { target: { value: 'l-2' } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: ' Job finished early ' } });
    expect(screen.getByRole('button', { name: 'Book 2 lines' })).toBeInTheDocument();
    fireEvent.click(bookButton());

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith('/inventory-returns', {
      reason: 'Job finished early',
      lines: [
        { issueTransactionId: 'a', quantity: 3, locationId: undefined },
        { issueTransactionId: 'b', quantity: 4, locationId: 'l-2' },
      ],
    }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    // A confirmation stays on the page, linking to today's returns from them in the Returned stock report.
    const link = await screen.findByRole('link', { name: 'See it in Returned stock' });
    expect(link.getAttribute('href')).toMatch(/^\/movements\?report=returned&recipientId=r-1&from=(\d{4}-\d\d-\d\d)&to=\1$/);
    expect(screen.getAllByText('Returned 2 items from Sabelo').length).toBeGreaterThan(0);
    expect(qtyFor('Cutting disc')).toHaveValue('');
  });

  it('refuses more than is out, and a line whose store is no longer in use, without calling the server', async () => {
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.change(qtyFor('Cutting disc'), { target: { value: '11' } });
    fireEvent.change(qtyFor('Welding gloves'), { target: { value: '1' } });
    expect(screen.getByText('At most 10')).toBeInTheDocument();
    expect(screen.getByText('Choose where it goes back')).toBeInTheDocument();
    fireEvent.click(bookButton());
    expect(await screen.findByText('Check the highlighted lines.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('asks for at least one quantity', async () => {
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.click(bookButton());
    expect(await screen.findByText('Enter how much of at least one item is coming back.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows what the server refuses, such as stock that came back meanwhile', async () => {
    mockPost.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Cannot return 3 × SKU-a: only 1 of the 12 issued is still out.' });
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.change(qtyFor('Cutting disc'), { target: { value: '3' } });
    fireEvent.click(bookButton());
    expect(await screen.findByText(/only 1 of the 12 issued is still out/)).toBeInTheDocument();
  });

  it('mints a fresh key when the recipient changes, so the new return is not refused as a reuse', async () => {
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.change(qtyFor('Cutting disc'), { target: { value: '3' } });
    fireEvent.click(bookButton());
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const firstKey = (mockPost.mock.calls[0]![2] as { idempotencyKey: string }).idempotencyKey;

    // A different recipient is a different return; its key must differ or the
    // server would refuse it as a key reused with different details.
    returnable = [line('c', 'Safety boots', '5')];
    fireEvent.change(screen.getByLabelText(/Returned by/), { target: { value: 'r-2' } });
    await screen.findByText('Safety boots');
    fireEvent.change(qtyFor('Safety boots'), { target: { value: '2' } });
    fireEvent.click(bookButton());
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    const secondKey = (mockPost.mock.calls[1]![2] as { idempotencyKey: string }).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  describe('items that track use', () => {
    beforeEach(() => {
      returnable = [
        line('d', 'Grinding disc', '10', { trackUse: true }),
        line('w', 'Welding rod', '5', { projectNumber: null }),
      ];
      mockPost.mockResolvedValue({ transactionIds: ['t-r1'], outcomeIds: ['o-1', 'o-2'] });
    });

    it('books back on the shelf, used up and broken for a line in one booking, and says what still out is left', async () => {
      renderAt('/stock/return?recipientId=r-1');
      await screen.findByText('Grinding disc');
      // Used up and broken are offered only on the item that tracks use.
      expect(screen.queryByLabelText(/^Used up: Welding rod/)).not.toBeInTheDocument();
      fireEvent.change(qtyFor('Grinding disc'), { target: { value: '2' } });
      fireEvent.change(usedFor('Grinding disc'), { target: { value: '6' } });
      fireEvent.change(brokenFor('Grinding disc'), { target: { value: '1' } });
      // Ten out, nine coming back: one still out after.
      const row = screen.getByText('Grinding disc').closest('tr')!;
      expect(row.lastElementChild!.textContent).toBe('1');
      fireEvent.change(qtyFor('Welding rod'), { target: { value: '1' } });
      fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Disc shattered on the grinder' } });
      fireEvent.click(bookButton());

      await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
      expect(mockPost).toHaveBeenCalledWith('/inventory-returns', {
        reason: 'Disc shattered on the grinder',
        lines: [
          { issueTransactionId: 'd', quantity: 2, usedUp: 6, broken: 1, locationId: undefined },
          { issueTransactionId: 'w', quantity: 1, locationId: undefined },
        ],
      }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
      expect((await screen.findAllByText('Sabelo: 3 back on the shelf, 6 used up, 1 broken')).length).toBeGreaterThan(0);
    });

    it('books a line that is only used up, with nothing going back on the shelf', async () => {
      renderAt('/stock/return?recipientId=r-1');
      await screen.findByText('Grinding disc');
      fireEvent.change(usedFor('Grinding disc'), { target: { value: '10' } });
      expect(intoFor('Grinding disc')).toBeDisabled();
      fireEvent.click(bookButton());
      await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
      expect(mockPost.mock.calls[0]![1]).toEqual({ reason: undefined, lines: [{ issueTransactionId: 'd', usedUp: 10, locationId: undefined }] });
      expect((await screen.findAllByText('Sabelo: 10 used up')).length).toBeGreaterThan(0);
      // Nothing went back on the shelf, so there is no return to see.
      expect(screen.queryByRole('link', { name: 'See it in Returned stock' })).not.toBeInTheDocument();
    });

    // Qodo, PR #144: 0.1 + 0.2 is 0.30000000000000004 in floating point.
    it('closes off an exact fractional remainder, 0.1 back and 0.2 used up of 0.3', async () => {
      returnable = [line('d', 'Grinding disc', '0.3', { trackUse: true, unitOfMeasure: 'kg' })];
      renderAt('/stock/return?recipientId=r-1');
      await screen.findByText('Grinding disc');
      fireEvent.change(qtyFor('Grinding disc'), { target: { value: '0.1' } });
      fireEvent.change(usedFor('Grinding disc'), { target: { value: '0.2' } });
      expect(screen.queryByText(/At most/)).not.toBeInTheDocument();
      expect(screen.getByText('Grinding disc').closest('tr')!.lastElementChild!.textContent).toBe('0');
      fireEvent.click(bookButton());
      await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
      expect(mockPost.mock.calls[0]![1]).toMatchObject({ lines: [{ issueTransactionId: 'd', quantity: 0.1, usedUp: 0.2 }] });
    });

    it('checks the three together against what is still out', async () => {
      renderAt('/stock/return?recipientId=r-1');
      await screen.findByText('Grinding disc');
      fireEvent.change(qtyFor('Grinding disc'), { target: { value: '4' } });
      fireEvent.change(usedFor('Grinding disc'), { target: { value: '6' } });
      fireEvent.change(brokenFor('Grinding disc'), { target: { value: '1' } });
      expect(screen.getByText('At most 10')).toBeInTheDocument();
      fireEvent.click(bookButton());
      expect(await screen.findByText('Check the highlighted lines.')).toBeInTheDocument();
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it('shows no used up or broken columns when nothing tracks use', async () => {
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    expect(screen.queryByRole('columnheader', { name: 'Used up' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Used up:/)).not.toBeInTheDocument();
  });

  it('says when nothing is out in the period', async () => {
    returnable = [];
    renderAt('/stock/return?recipientId=r-2');
    expect(await screen.findByText('Nothing to return')).toBeInTheDocument();
    expect(screen.getByText(/Nothing issued to Forklift since/)).toBeInTheDocument();
  });
});
