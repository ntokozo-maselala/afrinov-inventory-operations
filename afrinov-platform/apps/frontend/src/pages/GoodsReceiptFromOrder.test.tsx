// A goods receipt against a purchase order credits the order (procurement
// workflow Phase 1): the lines come from the order with what is outstanding,
// and each is sent with the order line it is for.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Store', roles: ['STORE_CONTROLLER'] } }) }));

const { GoodsReceipts } = await import('./GoodsReceipts');
const { ToastProvider } = await import('../components/Toast');

const ORDER = {
  id: 'po-1', number: 'AFRI-0412', status: 'PARTIALLY_RECEIVED', supplierId: 's-1', supplier: { name: 'Hydac' },
  lines: [
    { id: 'pol-1', materialId: 'm-1', orderedQty: '10', receivedQty: '4', material: { sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each' } },
    { id: 'pol-2', materialId: 'm-2', orderedQty: '5', receivedQty: '0', material: { sku: 'BOLT-M16', name: 'Hex bolt', unitOfMeasure: 'each' } },
    { id: 'pol-3', materialId: 'm-3', orderedQty: '2', receivedQty: '2', material: { sku: 'DONE-1', name: 'Already in', unitOfMeasure: 'each' } },
  ],
};

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders') return [ORDER, { ...ORDER, id: 'po-2', number: 'AFRI-0400', status: 'CLOSED' }];
    if (path === '/purchase-orders/po-1') return ORDER;
    if (path === '/suppliers') return [{ id: 's-1', name: 'Hydac' }, { id: 's-2', name: 'Other' }];
    if (path === '/locations') return [{ id: 'loc-1', name: 'Main store' }];
    if (path === '/materials') return [];
    return [];
  });
  mockPost.mockReset().mockImplementation(async (path: string) => (path === '/goods-receipts' ? { id: 'gr-9' } : {}));
});

async function openForOrder() {
  render(<MemoryRouter><ToastProvider><GoodsReceipts /></ToastProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'New receipt' }));
  await screen.findByRole('option', { name: 'AFRI-0412 · Hydac' });
  expect(screen.queryByRole('option', { name: /AFRI-0400/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Purchase order'), { target: { value: 'po-1' } });
  await screen.findByText('DISC-115 — Cutting disc');
}

describe('a goods receipt against a purchase order', () => {
  it('lists what is outstanding, takes the supplier from the order, and leaves fully received lines out', async () => {
    await openForOrder();
    expect(screen.getByText('6 each outstanding')).toBeInTheDocument();
    expect(screen.getByLabelText('Line 1 quantity')).toHaveValue(6);
    expect(screen.getByLabelText('Line 2 quantity')).toHaveValue(5);
    expect(screen.queryByText(/DONE-1/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Supplier/)).toHaveValue('s-1');
    expect(screen.getByLabelText(/^Supplier/)).toBeDisabled();
  });

  it('sends each line with its order line, and leaves out lines where none came', async () => {
    await openForOrder();
    fireEvent.change(screen.getByLabelText('Receive every line into'), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '2' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'None came' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Receive & post' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/goods-receipts', expect.objectContaining({
      purchaseOrderId: 'po-1', supplierId: 's-1',
      lines: [{ materialId: 'm-1', locationId: 'loc-1', quantity: 2, purchaseOrderLineId: 'pol-1' }],
    })));
    expect(mockPost).toHaveBeenCalledWith('/goods-receipts/gr-9/post');
  });

  it('refuses more than is outstanding before sending anything', async () => {
    await openForOrder();
    fireEvent.change(screen.getByLabelText('Receive every line into'), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive & post' }));
    expect(await screen.findByText('DISC-115 — Cutting disc: only 6 each is still outstanding.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('asks where each line goes', async () => {
    await openForOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Receive & post' }));
    expect(await screen.findByText('Choose where each line is going.')).toBeInTheDocument();
  });

  it('goes back to typed lines when the order is taken off', async () => {
    await openForOrder();
    fireEvent.change(screen.getByLabelText('Purchase order'), { target: { value: '' } });
    expect(screen.queryByText('DISC-115 — Cutting disc')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Supplier/)).not.toBeDisabled();
  });
});
