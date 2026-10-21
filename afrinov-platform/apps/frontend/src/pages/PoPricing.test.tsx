// Prices and VAT on purchase orders, as on the AFRI-0000_x template
// (procurement roadmap Phase 2): unit price per line, subtotal, VAT and net,
// the order total, and 0% VAT by default on orders in other currencies.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['PROCUREMENT'] } }) }));

const { PurchaseOrders } = await import('./PurchaseOrders');
const { PurchaseOrderDetail } = await import('./PurchaseOrderDetail');
const { ToastProvider } = await import('../components/Toast');
const { NewPurchaseOrder, EditPurchaseOrder } = await import('./PurchaseOrderForm');

const material = (id: string, sku: string, unitCost: string | null) => ({ id, sku, name: `Item ${sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '0', unitCost, active: true });
const SUPPLIERS = [{ id: 's-za', name: 'Hydac', active: true, currency: 'ZAR' }, { id: 's-eu', name: 'HS SRL', active: true, currency: 'EUR' }];
const MATERIALS = [material('m-1', 'DISC-115', '12.50'), material('m-2', 'BOLT-M16', null)];

const PRICED = {
  id: 'po-1', number: 'PO-2026-0001', status: 'PENDING_APPROVAL', supplierId: 's-za', supplier: { name: 'Hydac' }, createdAt: '2026-10-19T08:00:00Z',
  currency: 'ZAR', vatRate: '15',
  lines: [
    { id: 'l-1', materialId: 'm-1', material: { sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each' }, orderedQty: '3', receivedQty: '0', unitPrice: '12.5', subtotal: '37.50', vat: '5.63', net: '43.13' },
    { id: 'l-2', materialId: 'm-2', material: { sku: 'BOLT-M16', name: 'Bolt', unitOfMeasure: 'each' }, orderedQty: '10', receivedQty: '0', unitPrice: null, subtotal: null, vat: null, net: null },
  ],
  totals: { subtotal: '37.50', vat: '5.63', net: '43.13', unpricedLines: 1 },
};
const UNPRICED = { ...PRICED, id: 'po-2', number: 'PO-2026-0002', lines: [PRICED.lines[1]], totals: { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 1 } };

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders') return [PRICED, UNPRICED];
    if (path === '/purchase-orders/po-1') return PRICED;
    if (path.endsWith('/approval')) return { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 1, currency: 'ZAR', canApprove: false, reason: null, myLimit: null, approvers: [] };
    if (path.startsWith('/purchase-orders/')) return [];
    if (path === '/suppliers') return SUPPLIERS;
    if (path === '/materials') return MATERIALS;
    if (path.startsWith('/settings/values')) return { 'purchaseOrders.vatRate': 15 };
    return [];
  });
  mockPost.mockReset().mockResolvedValue({ id: 'po-1', number: 'PO-2026-0001' });
  mockPatch.mockReset().mockResolvedValue({});
});

// The order routes as App.tsx has them, so links and buttons really navigate.
const appAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <Routes>
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/new" element={<NewPurchaseOrder />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
        <Route path="/purchase-orders/:id/edit" element={<EditPurchaseOrder />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);
const listPage = () => appAt('/purchase-orders');
const detailPage = () => appAt('/purchase-orders/po-1');
const money = (n: string) => new RegExp(n.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'));

describe('Purchase orders list', () => {
  it('shows each order total, and says when an order has no prices', async () => {
    listPage();
    const priced = (await screen.findByText('PO-2026-0001')).closest('tr')!;
    expect(within(priced).getByText(money('43.13'))).toBeInTheDocument();
    expect(within(priced).getByText('1 unpriced')).toBeInTheDocument();
    expect(within(screen.getByText('PO-2026-0002').closest('tr')!).getByText('No prices')).toBeInTheDocument();
  });
});

describe('New purchase order', () => {
  // Opened from the menu's New purchase order, which links here.
  async function openForm() {
    appAt('/purchase-orders/new');
    await screen.findByRole('heading', { name: 'New purchase order' });
  }

  it('starts the price at the item unit cost, and sends prices and the VAT rate', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/^Supplier/), { target: { value: 's-za' } });
    expect(screen.getByLabelText('VAT rate (%)')).toHaveValue(15);
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue(12.5);
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '3' } });
    expect(within(screen.getByLabelText('Order total')).getByText(money('43.13'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create & submit' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({
      supplierId: 's-za', vatRate: 15, lines: [{ materialId: 'm-1', orderedQty: 3, unitPrice: 12.5 }],
    })));
  });

  it('starts a euro order at 0% VAT, and leaves out a price the buyer left blank', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/^Supplier/), { target: { value: 's-eu' } });
    expect(screen.getByLabelText('VAT rate (%)')).toHaveValue(0);
    expect(screen.getByText('EUR orders start at 0%.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-2' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '10' } });
    expect(screen.getByText(/1 line has no price yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create & submit' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({
      vatRate: 0, lines: [{ materialId: 'm-2', orderedQty: 10 }],
    })));
  });

  it('refuses a VAT rate over 100', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/^Supplier/), { target: { value: 's-za' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('VAT rate (%)'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & submit' }));
    expect(await screen.findByText('VAT rate must be between 0 and 100.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('line Units and Subtotal, as on the template', () => {
  it('shows each line\u2019s units from its item, and its subtotal before VAT', async () => {
    appAt('/purchase-orders/new');
    await screen.findByRole('heading', { name: 'New purchase order' });
    fireEvent.change(await screen.findByLabelText(/^Supplier/), { target: { value: 's-za' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(screen.getByLabelText('Line 1 units')).toHaveTextContent('—');
    expect(screen.getByLabelText('Line 1 subtotal')).toHaveTextContent('—');
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    expect(screen.getByLabelText('Line 1 units')).toHaveTextContent('each');
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '3' } });
    expect(screen.getByLabelText('Line 1 subtotal')).toHaveTextContent(money('37.50'));
  });

  it('on Edit, shows units, quantity and the subtotal at the price being typed', async () => {
    appAt('/purchase-orders/po-1/edit');
    expect(await screen.findByLabelText('BOLT-M16 units')).toHaveTextContent('each');
    expect(screen.getByLabelText('BOLT-M16 quantity')).toHaveTextContent('10');
    expect(screen.getByLabelText('BOLT-M16 subtotal')).toHaveTextContent('—');
    fireEvent.change(screen.getByLabelText('BOLT-M16 unit price'), { target: { value: '4.2' } });
    expect(screen.getByLabelText('BOLT-M16 subtotal')).toHaveTextContent(money('42.00'));
  });
});

describe('Purchase order detail', () => {
  it('shows each line price, subtotal, VAT and net, and the order total', async () => {
    detailPage();
    const line = (await screen.findByText('Cutting disc')).closest('tr')!;
    for (const n of ['12.50', '37.50', '5.63', '43.13']) expect(within(line).getByText(money(n))).toBeInTheDocument();
    expect(within(screen.getByText('Bolt').closest('tr')!).getByText('No price')).toBeInTheDocument();
    const totals = screen.getByLabelText('Order total');
    expect(within(totals).getByText('VAT 15%')).toBeInTheDocument();
    expect(within(totals).getByText(money('43.13'))).toBeInTheDocument();
    expect(screen.getByText(/1 line has no price and is not in the total/)).toBeInTheDocument();
  });

  it('adds a missing price on the Edit page, sending only what changed', async () => {
    detailPage();
    await screen.findByText('Cutting disc');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add prices' })[0]!);
    fireEvent.change(await screen.findByLabelText('BOLT-M16 unit price'), { target: { value: '4.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    const body = mockPatch.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.linePrices).toEqual([{ lineId: 'l-2', unitPrice: 4.2 }]);
    expect(body).not.toHaveProperty('vatRate');
  });

  it('changes the VAT rate on the order', async () => {
    detailPage();
    await screen.findByText('Cutting disc');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('VAT rate (%)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/purchase-orders/po-1', expect.objectContaining({ vatRate: 0 })));
    expect(mockPatch.mock.calls[0]![1]).not.toHaveProperty('linePrices');
  });
});
