// One way to receive, whatever arrives (procurement workflow Phase 4):
// Receive delivery on the order's page books part of an order, Receive stock
// asks whether a delivery is against one of the supplier's open orders.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Fragment } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Store', roles: auth.roles } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { PurchaseOrderDetail } = await import('./PurchaseOrderDetail');
const { ReceiveStock } = await import('./ReceiveStock');
const { ToastProvider } = await import('../components/Toast');

const ORDER = {
  id: 'po-1', number: 'AFRI-0412', status: 'APPROVED', supplierId: 's-1', supplier: { name: 'Hydac' }, createdAt: '2026-10-01T08:00:00Z',
  currency: 'ZAR', vatRate: '15', expectedDeliveryDate: '2026-11-02', totals: { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0 },
  lines: [
    { id: 'pol-1', materialId: 'm-1', orderedQty: '10', receivedQty: '4', unitPrice: '1', material: { sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each' } },
    { id: 'pol-2', materialId: 'm-2', orderedQty: '5', receivedQty: '0', unitPrice: '1', material: { sku: 'BOLT-M16', name: 'Hex bolt', unitOfMeasure: 'each' } },
  ],
};

beforeEach(() => {
  auth.roles = ['STORE_CONTROLLER'];
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders') return [ORDER, { ...ORDER, id: 'po-2', number: 'AFRI-0400', status: 'CLOSED' }];
    if (path === '/purchase-orders/po-1') return ORDER;
    if (path.endsWith('/approval')) return { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0, currency: 'ZAR', canApprove: false, reason: null, myLimit: null, approvers: [] };
    if (path.startsWith('/suppliers')) return [{ id: 's-1', name: 'Hydac', active: true }, { id: 's-2', name: 'Other', active: true }];
    if (path.startsWith('/locations')) return [{ id: 'loc-1', name: 'Main store', active: true }, { id: 'loc-2', name: 'Yard', active: true }];
    if (path === '/goods-receipts') return [
      { id: 'gr-1', number: 'GR-2026-0001', status: 'POSTED', supplier: { name: 'Hydac' }, receivedAt: '2026-10-02T08:00:00Z', purchaseOrderId: 'po-1', purchaseOrder: { id: 'po-1', number: 'AFRI-0412' }, lines: [] },
      { id: 'gr-2', number: 'GR-2026-0002', status: 'POSTED', supplier: { name: 'Other' }, receivedAt: '2026-10-01T08:00:00Z', purchaseOrder: null, lines: [] },
    ];
    return [];
  });
  mockPost.mockReset().mockImplementation(async (path: string) => (path === '/goods-receipts' ? { id: 'gr-9', number: 'GR-2026-0009' } : { number: 'GR-2026-0010' }));
});

// A Stores order (no project), received by the store from Order stock. Its
// old Procurement address is routed too, to check the move to Order stock;
// each address gets its own page (a key), so nothing is carried over but the link.
function Where() { return <p data-testid="at">{useLocation().pathname}</p>; }
const orderPage = (url = '/stock/orders/po-1') => render(
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <Routes>
        <Route path="/stock/orders/:id" element={<Fragment key="stores"><PurchaseOrderDetail /><Where /></Fragment>} />
        <Route path="/purchase-orders/:id" element={<Fragment key="projects"><PurchaseOrderDetail /><Where /></Fragment>} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

describe('Receive delivery on the order page', () => {
  it('books what arrived, line by line, as a goods receipt against the order', async () => {
    orderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive delivery' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('6 each outstanding')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Line 1 quantity')).toHaveValue(6);
    fireEvent.change(within(dialog).getByLabelText('Line 1 quantity'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'None came' })[1]!);
    await within(dialog).findAllByRole('option', { name: 'Yard' });
    fireEvent.change(within(dialog).getByLabelText('Receive every line into'), { target: { value: 'loc-2' } });
    fireEvent.change(within(dialog).getByLabelText(/Delivery note/), { target: { value: 'INV-77' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Receive' }));
    // Recorded and posted in one call, so a failure leaves no unposted receipt.
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/goods-receipts', {
      supplierId: 's-1', purchaseOrderId: 'po-1', deliveryRef: 'INV-77',
      lines: [{ materialId: 'm-1', locationId: 'loc-2', quantity: 2, purchaseOrderLineId: 'pol-1' }],
      post: true,
    }));
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Received on GR-2026-0009')).toBeInTheDocument();
  });

  it('refuses more than is outstanding, or a line with nowhere to go', async () => {
    orderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive delivery' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Receive' }));
    expect(await within(dialog).findByText('Choose where each line is going.')).toBeInTheDocument();
    await within(dialog).findAllByRole('option', { name: 'Yard' });
    fireEvent.change(within(dialog).getByLabelText('Receive every line into'), { target: { value: 'loc-1' } });
    fireEvent.change(within(dialog).getByLabelText('Line 2 quantity'), { target: { value: '9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Receive' }));
    expect(await within(dialog).findByText(/BOLT-M16 — Hex bolt: only 5 each is still outstanding/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('opens straight away from a Receive stock link', async () => {
    orderPage('/stock/orders/po-1?receive=1');
    expect(await screen.findByRole('dialog')).toHaveTextContent('Receive delivery');
  });

  // Qodo, PR #119: an old link to the order under Procurement moves it to
  // Order stock, still opening Receive delivery.
  it('opens Receive delivery from an old link, once moved to Order stock', async () => {
    orderPage('/purchase-orders/po-1?receive=1');
    expect(await screen.findByRole('dialog')).toHaveTextContent('Receive delivery');
    expect(screen.getByTestId('at')).toHaveTextContent('/stock/orders/po-1');
  });

  it('is not offered to the buyer', async () => {
    auth.roles = ['PROCUREMENT'];
    orderPage('/stock/orders/po-1?receive=1');
    await screen.findByText('Cutting disc');
    expect(screen.queryByRole('button', { name: 'Receive delivery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Receive stock with open orders', () => {
  const receiveStock = () => render(<MemoryRouter><ToastProvider><ReceiveStock /></ToastProvider></MemoryRouter>);

  it('asks whether the delivery is against one of the supplier’s open orders', async () => {
    receiveStock();
    await screen.findByRole('option', { name: 'Hydac' });
    fireEvent.change(screen.getByLabelText(/Supplier/), { target: { value: 's-1' } });
    expect(await screen.findByText('Is this delivery against a purchase order?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Receive against AFRI-0412' })).toHaveAttribute('href', '/stock/orders/po-1?receive=1');
    expect(screen.queryByRole('link', { name: /AFRI-0400/ })).not.toBeInTheDocument();
    expect(screen.getByText(/2 lines outstanding/)).toBeInTheDocument();
  });

  it('books a counter receipt once told it isn’t against an order', async () => {
    receiveStock();
    await screen.findByRole('option', { name: 'Hydac' });
    fireEvent.change(screen.getByLabelText(/Supplier/), { target: { value: 's-1' } });
    await screen.findByText('Is this delivery against a purchase order?');
    fireEvent.change(screen.getByLabelText(/Delivery note/), { target: { value: 'INV-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    expect(await screen.findByText(/This supplier has open purchase orders/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /No, it isn.t against an order/ }));
    expect(screen.queryByText('Is this delivery against a purchase order?')).not.toBeInTheDocument();
    expect(screen.getByText(/Booked as a counter receipt/)).toBeInTheDocument();
  });

  it('does not ask a supplier with no open orders', async () => {
    receiveStock();
    await screen.findByRole('option', { name: 'Other' });
    fireEvent.change(screen.getByLabelText(/Supplier/), { target: { value: 's-2' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/purchase-orders'));
    expect(screen.queryByText('Is this delivery against a purchase order?')).not.toBeInTheDocument();
  });

  it('does not ask the buyer, who receives no orders', async () => {
    auth.roles = ['PROCUREMENT'];
    receiveStock();
    await screen.findByRole('option', { name: 'Hydac' });
    fireEvent.change(screen.getByLabelText(/Supplier/), { target: { value: 's-1' } });
    expect(screen.queryByText('Is this delivery against a purchase order?')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/purchase-orders');
  });
});

