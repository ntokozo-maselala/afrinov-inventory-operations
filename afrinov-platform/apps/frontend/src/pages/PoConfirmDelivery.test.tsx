// Confirm delivery on a project order (Stores and Procurement Separation
// Roadmap, Phase 3): project material goes from the supplier straight to
// site, so Procurement records what arrived on the order and no stock is
// added; the store receives only its own Stores orders.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { roles: ['PROCUREMENT'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Thandi Buyer', roles: auth.roles } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));
vi.mock('../lib/poDocument', async (original) => ({ ...(await original<object>()), downloadPoDocument: vi.fn() }));

const { PurchaseOrderDetail } = await import('./PurchaseOrderDetail');
const { ToastProvider } = await import('../components/Toast');

const ORDER = {
  id: 'po-1', number: 'AFRI-0500', status: 'APPROVED', supplierId: 's-1', supplier: { name: 'EMV Africa' }, projectNumber: 'AFRI-1402',
  createdAt: '2026-10-20T08:00:00Z', currency: 'ZAR', vatRate: '15', totals: { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0 },
  lines: [
    { id: 'l-1', materialId: 'm-1', orderedQty: '10', receivedQty: '4', unitPrice: '1', material: { sku: '1402-RAIL', name: 'Door rail', unitOfMeasure: 'm' } },
    { id: 'l-2', materialId: 'm-2', orderedQty: '2', receivedQty: '2', unitPrice: '1', material: { sku: '1402-WHEEL', name: 'Rail wheel', unitOfMeasure: 'each' } },
  ],
};

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders/po-1') return ORDER;
    if (path.endsWith('/approval')) return { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0, currency: 'ZAR', canApprove: false, reason: null, myLimit: null, approvers: [] };
    return [];
  });
  mockPost.mockReset().mockResolvedValue({ status: 'RECEIVED' });
});

const page = () => render(
  <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
    <ToastProvider><Routes><Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} /></Routes></ToastProvider>
  </MemoryRouter>,
);

describe('Confirm delivery on a project order', () => {
  it('offers the buyer Confirm delivery, not Receive delivery', async () => {
    page();
    expect(await screen.findByRole('button', { name: 'Confirm delivery' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive delivery' })).not.toBeInTheDocument();
  });

  it('records what arrived on site, line by line, starting from what is outstanding', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delivery' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('no stock is added');
    // Only the line still owed, at its outstanding 6.
    expect(screen.getByLabelText('1402-RAIL delivered')).toHaveValue(6);
    expect(screen.queryByLabelText('1402-WHEEL delivered')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('1402-RAIL delivered'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Delivery note / reference'), { target: { value: 'DN-4410' } });
    fireEvent.change(screen.getByLabelText('Delivered on'), { target: { value: '2026-10-28' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm delivery' }).at(-1)!);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-1/confirm-delivery', {
      lines: [{ lineId: 'l-1', quantity: 2.5 }], deliveryRef: 'DN-4410', deliveredOn: '2026-10-28',
    }));
  });

  // Qodo, PR #121: quantities to 4 decimal places, as the order line keeps them.
  it('starts a fractional line at its outstanding to 4 places, and refuses finer', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/po-1') return { ...ORDER, lines: [{ ...ORDER.lines[0]!, orderedQty: '2.5', receivedQty: '1.2' }] };
      return [];
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delivery' }));
    // 2.5 − 1.2 is 1.3 here, not 1.2999999999999998.
    expect(await screen.findByLabelText('1402-RAIL delivered')).toHaveValue(1.3);
    fireEvent.change(screen.getByLabelText('1402-RAIL delivered'), { target: { value: '1.23456' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm delivery' }).at(-1)!);
    expect(await screen.findByText(/to at most 4 decimal places/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('refuses more than is outstanding before asking the server', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delivery' }));
    fireEvent.change(await screen.findByLabelText('1402-RAIL delivered'), { target: { value: '7' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm delivery' }).at(-1)!);
    expect(await screen.findByText(/1402-RAIL: enter what arrived, from 0 to the 6 outstanding/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('offers the storeman neither: project material never reaches the store', async () => {
    auth.roles = ['STORE_CONTROLLER'];
    page();
    await screen.findByText('Door rail');
    expect(screen.queryByRole('button', { name: 'Receive delivery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm delivery' })).not.toBeInTheDocument();
  });
});
