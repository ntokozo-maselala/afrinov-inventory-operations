// One place to receive (Stores and Procurement Separation Roadmap): every
// delivery to the store is booked on Receive stock, and with procurement on
// only against an approved Stores order. The order's outstanding lines are
// filled in and the receipt credits the order; the order is closed from the
// confirmation, or with the delivery when nothing more is coming. The order's
// page and its old links send a delivery there.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Fragment } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { mockGet, mockPost, auth, after } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), auth: { roles: ['STORE_CONTROLLER'] as string[] },
  // The order's status once the delivery is booked.
  after: { status: 'PARTIALLY_RECEIVED' },
}));
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
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
const withKey = expect.objectContaining({ idempotencyKey: expect.any(String) });

beforeEach(() => {
  auth.roles = ['STORE_CONTROLLER'];
  after.status = 'PARTIALLY_RECEIVED';
  let booked = false;
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders?kind=stores') return [
      ORDER,
      { ...ORDER, id: 'po-2', number: 'AFRI-0400', status: 'CLOSED' },
      { ...ORDER, id: 'po-3', number: 'AFRI-0420', status: 'PENDING_APPROVAL' },
      { ...ORDER, id: 'po-4', number: 'AFRI-0401', status: 'PARTIALLY_RECEIVED', supplierId: 's-2', supplier: { name: 'Other' }, expectedDeliveryDate: null },
    ];
    if (path === '/purchase-orders/po-1') return booked ? { ...ORDER, status: after.status } : ORDER;
    if (path.endsWith('/approval')) return { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0, currency: 'ZAR', canApprove: false, reason: null, myLimit: null, approvers: [] };
    if (path.startsWith('/suppliers')) return [{ id: 's-1', name: 'Hydac', active: true }, { id: 's-2', name: 'Other', active: true }];
    if (path.startsWith('/locations')) return [{ id: 'loc-1', name: 'Main store', active: true }, { id: 'loc-2', name: 'Yard', active: true }];
    return [];
  });
  mockPost.mockReset().mockImplementation(async (path: string, body?: { reason?: string }) => {
    if (path === '/goods-receipts') { booked = true; return { id: 'gr-9', number: 'GR-2026-0009' }; }
    if (path.endsWith('/close')) return { status: 'CLOSED', closeReason: body?.reason ?? null };
    return { number: 'GR-2026-0010' };
  });
});

function Where() { const l = useLocation(); return <p data-testid="at">{l.pathname}{l.search}</p>; }

describe('Receive delivery on the order page', () => {
  // A Stores order (no project), received by the store. Its old Procurement
  // address is routed too; each address gets its own page (a key).
  const orderPage = (url = '/stock/orders/po-1') => render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Routes>
          <Route path="/stock/orders/:id" element={<Fragment key="stores"><PurchaseOrderDetail /><Where /></Fragment>} />
          <Route path="/purchase-orders/:id" element={<Fragment key="projects"><PurchaseOrderDetail /><Where /></Fragment>} />
          <Route path="/stock/receive" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

  it('takes the delivery to Receive stock, with the order chosen', async () => {
    orderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive delivery' }));
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/stock/receive?order=po-1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends an older Receive link to Receive stock', async () => {
    orderPage('/stock/orders/po-1?receive=1');
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/stock/receive?order=po-1'));
  });

  // Qodo, PR #119: an old link to the order under Procurement.
  it('sends an older Receive link at the Procurement address to Receive stock', async () => {
    orderPage('/purchase-orders/po-1?receive=1');
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/stock/receive?order=po-1'));
  });

  it('is not offered to the buyer, whose old link just opens the order', async () => {
    auth.roles = ['PROCUREMENT'];
    orderPage('/stock/orders/po-1?receive=1');
    await screen.findByText('Cutting disc');
    expect(screen.queryByRole('button', { name: 'Receive delivery' })).not.toBeInTheDocument();
    expect(screen.getByTestId('at').textContent).toBe('/stock/orders/po-1');
  });
});

describe('Receive stock against an approved order', () => {
  const receiveStock = (url = '/stock/receive') => render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Routes>
          <Route path="/stock/receive" element={<ReceiveStock />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  async function chooseOrder(id = 'po-1') {
    fireEvent.change(await screen.findByLabelText(/^Order/), { target: { value: id } });
    await screen.findByText(/^What arrived against/);
  }
  async function fillAndReceive(ref = 'INV-77') {
    await screen.findAllByRole('option', { name: 'Yard' });
    fireEvent.change(screen.getByLabelText('Receive every line into'), { target: { value: 'loc-2' } });
    fireEvent.change(screen.getByLabelText(/Delivery note/), { target: { value: ref } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  }

  it('offers only the store\u2019s approved orders still to come, with supplier and what each owes', async () => {
    receiveStock();
    expect(await screen.findByRole('option', { name: /AFRI-0412 · Hydac · 2 lines outstanding, expected/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AFRI-0401 · Other · 2 lines outstanding' })).toBeInTheDocument();
    // Not closed, not waiting for approval.
    expect(screen.queryByRole('option', { name: /AFRI-0400/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /AFRI-0420/ })).not.toBeInTheDocument();
    // No receipt without an order: no supplier to pick, no free lines, no new items.
    expect(screen.queryByLabelText(/^Supplier/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add another item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New item' })).not.toBeInTheDocument();
  });

  it('asks for the order before booking anything', async () => {
    receiveStock();
    await screen.findByRole('option', { name: /AFRI-0412/ });
    fireEvent.change(screen.getByLabelText(/Delivery note/), { target: { value: 'INV-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    expect(await screen.findByText('Choose the order this delivery is against.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('says when no approved order is waiting, and points to Order stock', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?kind=stores') return [{ ...ORDER, status: 'RECEIVED' }];
      if (path.startsWith('/locations')) return [{ id: 'loc-1', name: 'Main store', active: true }];
      return [];
    });
    receiveStock();
    expect(await screen.findByText('No approved orders are waiting for delivery')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Order stock' })).toHaveAttribute('href', '/stock/orders');
    expect(screen.queryByRole('button', { name: 'Receive stock' })).not.toBeInTheDocument();
  });

  it('books what arrived, line by line, as a goods receipt against the order', async () => {
    receiveStock();
    await chooseOrder();
    expect(screen.getByText('Supplier: Hydac')).toBeInTheDocument();
    expect(screen.getByText('6 each outstanding')).toBeInTheDocument();
    expect(screen.getByLabelText('Line 1 quantity')).toHaveValue(6);
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '2' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'None came' })[1]!);
    await fillAndReceive();
    // Recorded and posted in one call, retry-safe, so a failure leaves no unposted receipt.
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/goods-receipts', {
      supplierId: 's-1', purchaseOrderId: 'po-1', deliveryRef: 'INV-77', receivedAt: today,
      lines: [{ materialId: 'm-1', locationId: 'loc-2', quantity: 2, purchaseOrderLineId: 'pol-1' }],
      post: true,
    }, withKey));
    expect(await screen.findByText('Received on GR-2026-0009 against AFRI-0412')).toBeInTheDocument();
    expect(screen.getByText('The rest of AFRI-0412 stays outstanding for its next delivery.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close AFRI-0412' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open AFRI-0412' })).toHaveAttribute('href', '/stock/orders/po-1');
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalledWith('/stock-receipts', expect.anything(), expect.anything());
  });

  it('refuses more than is outstanding, or a line with nowhere to go', async () => {
    receiveStock();
    await chooseOrder();
    fireEvent.change(screen.getByLabelText(/Delivery note/), { target: { value: 'INV-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    expect(await screen.findByText('Choose where each line is going.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Receive every line into'), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText('Line 2 quantity'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    expect(await screen.findByText(/BOLT-M16 — Hex bolt: only 5 each is still outstanding/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('closes a completed order from the confirmation', async () => {
    after.status = 'RECEIVED';
    receiveStock();
    await chooseOrder();
    await fillAndReceive();
    expect(await screen.findByText(/Everything on AFRI-0412 has arrived/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close AFRI-0412' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-1/close', {}));
    expect(await screen.findByText('AFRI-0412 is closed.')).toBeInTheDocument();
  });

  it('closes the order short with the delivery when nothing more is coming, with a reason', async () => {
    receiveStock();
    await chooseOrder();
    fireEvent.click(screen.getAllByRole('button', { name: 'None came' })[1]!);
    fireEvent.click(screen.getByRole('checkbox', { name: /Nothing more is coming/ }));
    await fillAndReceive();
    expect(await screen.findByText(/Say why nothing more is coming/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Why nothing more is coming/), { target: { value: 'Discontinued' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-1/close', { reason: 'Discontinued' }));
    expect(await screen.findByText('AFRI-0412 is closed.')).toBeInTheDocument();
  });

  it('closes the order as asked when the delivery completes it', async () => {
    after.status = 'RECEIVED';
    receiveStock();
    await chooseOrder();
    fireEvent.click(screen.getByRole('checkbox', { name: /Nothing more is coming/ }));
    fireEvent.change(screen.getByLabelText(/Why nothing more is coming/), { target: { value: 'All here' } });
    await fillAndReceive();
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-1/close', { reason: 'All here' }));
    expect(await screen.findByText('AFRI-0412 is closed.')).toBeInTheDocument();
  });

  it('keeps the order a link names when the orders fail to load, and offers a retry', async () => {
    let fail = true;
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?kind=stores' && fail) throw { code: 'SERVICE_UNAVAILABLE', message: 'Try again shortly' };
      return base(path);
    });
    receiveStock('/stock/receive?order=po-1');
    expect(await screen.findByText('The store\u2019s open orders could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText(/That order has nothing left to receive/)).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('What arrived against AFRI-0412')).toBeInTheDocument();
  });

  // Qodo, PR #125: with nothing to choose from, no form is offered.
  it('offers no form when the orders fail to load', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?kind=stores') throw { code: 'SERVICE_UNAVAILABLE', message: 'Try again shortly' };
      if (path.startsWith('/locations')) return [{ id: 'loc-1', name: 'Main store', active: true }];
      return [];
    });
    receiveStock();
    expect(await screen.findByText('The store’s open orders could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive stock' })).not.toBeInTheDocument();
  });

  // Qodo, PR #125: an item's Receive starts on the orders still owed that item.
  describe('from an item', () => {
    const owedOnlyBolts = { ...ORDER, id: 'po-4', number: 'AFRI-0401', lines: [{ ...ORDER.lines[0]!, receivedQty: '10' }, ORDER.lines[1]!] };
    beforeEach(() => {
      const base = mockGet.getMockImplementation()!;
      mockGet.mockImplementation(async (path: string) => (path === '/purchase-orders?kind=stores' ? [ORDER, owedOnlyBolts] : base(path)));
    });

    it('chooses the only order still owed the item', async () => {
      receiveStock('/stock/receive?materialId=m-1');
      expect(await screen.findByText('What arrived against AFRI-0412')).toBeInTheDocument();
      expect(screen.getByText('Showing the orders still owed DISC-115 — Cutting disc')).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /AFRI-0401/ })).not.toBeInTheDocument();
    });

    it('lists every order still owed the item, for the storeman to choose', async () => {
      receiveStock('/stock/receive?materialId=m-2');
      expect(await screen.findByRole('option', { name: /AFRI-0412/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /AFRI-0401/ })).toBeInTheDocument();
      expect(screen.getByLabelText(/^Order/)).toHaveValue('');
    });

    it('says when no order is owed the item, and shows them all on request', async () => {
      receiveStock('/stock/receive?materialId=m-9');
      expect(await screen.findByText('No approved order is waiting for this item')).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Order/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Show all orders' }));
      expect(await screen.findByRole('option', { name: /AFRI-0412/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /AFRI-0401/ })).toBeInTheDocument();
    });
  });

  it('says the delivery was booked when the order then fails to close', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/goods-receipts') return { id: 'gr-9', number: 'GR-2026-0009' };
      throw { code: 'SERVICE_UNAVAILABLE', message: 'Try again shortly' };
    });
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?kind=stores') return [ORDER];
      if (path === '/purchase-orders/po-1') return { ...ORDER, status: 'PARTIALLY_RECEIVED' };
      if (path.startsWith('/locations')) return [{ id: 'loc-2', name: 'Yard', active: true }];
      return [];
    });
    receiveStock();
    await chooseOrder();
    fireEvent.click(screen.getByRole('checkbox', { name: /Nothing more is coming/ }));
    fireEvent.change(screen.getByLabelText(/Why nothing more is coming/), { target: { value: 'Discontinued' } });
    await fillAndReceive();
    expect(await screen.findByText('Received, but AFRI-0412 could not be closed')).toBeInTheDocument();
    expect(screen.getByText('Received on GR-2026-0009 against AFRI-0412')).toBeInTheDocument();
    expect(screen.queryByText('Cannot receive')).not.toBeInTheDocument();
  });

  it('starts on the order a link names', async () => {
    receiveStock('/stock/receive?order=po-1');
    expect(await screen.findByText('What arrived against AFRI-0412')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Order/)).toHaveValue('po-1');
  });

  it('says so when a link names an order with nothing left to receive', async () => {
    receiveStock('/stock/receive?order=po-3');
    expect(await screen.findByText(/That order has nothing left to receive/)).toBeInTheDocument();
  });

  it('is not open to the buyer, who receives no orders', async () => {
    auth.roles = ['PROCUREMENT'];
    receiveStock();
    expect(await screen.findByText(/Your role cannot receive the store.s orders/)).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/purchase-orders?kind=stores');
  });
});
