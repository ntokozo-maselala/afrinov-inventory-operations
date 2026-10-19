import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

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
const qtyFor = (name: string) => screen.getByLabelText(new RegExp(`^Coming back: ${name}`));
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
    fireEvent.click(screen.getByRole('button', { name: 'Return stock' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith('/inventory-returns', {
      reason: 'Job finished early',
      lines: [
        { issueTransactionId: 'a', quantity: 3, locationId: undefined },
        { issueTransactionId: 'b', quantity: 4, locationId: 'l-2' },
      ],
    });
    expect(await screen.findByText('Returned 2 items from Sabelo')).toBeInTheDocument();
    expect(qtyFor('Cutting disc')).toHaveValue('');
  });

  it('refuses more than is out, and a line whose store is no longer in use, without calling the server', async () => {
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.change(qtyFor('Cutting disc'), { target: { value: '11' } });
    fireEvent.change(qtyFor('Welding gloves'), { target: { value: '1' } });
    expect(screen.getByText('At most 10')).toBeInTheDocument();
    expect(screen.getByText('Choose where it goes back')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return stock' }));
    expect(await screen.findByText('Check the highlighted lines.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('asks for at least one quantity', async () => {
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.click(screen.getByRole('button', { name: 'Return stock' }));
    expect(await screen.findByText('Enter how much of at least one item is coming back.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows what the server refuses, such as stock that came back meanwhile', async () => {
    mockPost.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Cannot return 3 × SKU-a: only 1 of the 12 issued is still out.' });
    renderAt('/stock/return?recipientId=r-1');
    await screen.findByText('Cutting disc');
    fireEvent.change(qtyFor('Cutting disc'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return stock' }));
    expect(await screen.findByText(/only 1 of the 12 issued is still out/)).toBeInTheDocument();
  });

  it('says when nothing is out in the period', async () => {
    returnable = [];
    renderAt('/stock/return?recipientId=r-2');
    expect(await screen.findByText('Nothing to return')).toBeInTheDocument();
    expect(screen.getByText(/Nothing issued to Forklift since/)).toBeInTheDocument();
  });
});
