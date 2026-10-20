// Saving a purchase order as a draft and submitting it later (workflow
// roadmap Phase 3): the form on its own pages, Save draft beside Create &
// submit, Submit for approval on a draft's page, and the list opening a
// buyer's drafts and orders awaiting approval.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch, auth } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(), auth: { roles: ['PROCUREMENT'] as string[] },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Buyer', roles: auth.roles } }) }));

const { PurchaseOrders } = await import('./PurchaseOrders');
const { PurchaseOrderDetail } = await import('./PurchaseOrderDetail');
const { NewPurchaseOrder, EditPurchaseOrder } = await import('./PurchaseOrderForm');
const { ToastProvider } = await import('../components/Toast');

const line = (id: string, unitPrice: string | null) => ({
  id, materialId: 'm-1', material: { sku: `SKU-${id}`, name: `Item ${id}`, unitOfMeasure: 'each' },
  orderedQty: '2', receivedQty: '0', unitPrice, subtotal: null, vat: null, net: null,
});
const order = (id: string, number: string, status: string, lines = [line('l-1', '10')]) => ({
  id, number, status, supplierId: 's-1', supplier: { name: 'Hydac' }, createdAt: '2026-10-19T08:00:00Z',
  currency: 'ZAR', vatRate: '15', totals: { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0 }, lines,
});
const DRAFT = order('po-d', 'AFRI-0101', 'DRAFT', [line('l-1', '10'), line('l-2', null)]);
const PENDING = order('po-p', 'AFRI-0102', 'PENDING_APPROVAL');
const APPROVED = order('po-a', 'AFRI-0103', 'APPROVED');
const RECEIVED = order('po-r', 'AFRI-0104', 'RECEIVED');
const ORDERS = [DRAFT, PENDING, APPROVED, RECEIVED];

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders') return ORDERS;
    const found = ORDERS.find((o) => path === `/purchase-orders/${o.id}`);
    if (found) return found;
    if (path.endsWith('/approval')) return { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0, currency: 'ZAR', canApprove: false, reason: null, myLimit: null, approvers: [] };
    if (path.startsWith('/purchase-orders/')) return [];
    if (path === '/suppliers') return [{ id: 's-1', name: 'Hydac', active: true, currency: 'ZAR' }];
    if (path === '/materials') return [{ id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '0', unitCost: '5', active: true }];
    if (path.startsWith('/settings/values')) return { 'purchaseOrders.vatRate': 15 };
    return [];
  });
  mockPost.mockReset().mockImplementation(async (path: string) => (path === '/purchase-orders' ? { id: 'po-d', number: 'AFRI-0101' } : {}));
  mockPatch.mockReset().mockResolvedValue({});
});

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

async function fillOrder() {
  appAt('/purchase-orders/new');
  await screen.findByRole('heading', { name: 'New purchase order' });
  fireEvent.change(await screen.findByLabelText(/^Supplier/), { target: { value: 's-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
  fireEvent.change(await screen.findByLabelText('Line 1 material'), { target: { value: 'm-1' } });
  fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '2' } });
}

describe('New purchase order page', () => {
  it('saves a draft without submitting it, and opens the order', async () => {
    await fillOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('heading', { name: 'AFRI-0101' });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({ supplierId: 's-1' }));
    expect(await screen.findByText('AFRI-0101 saved as a draft')).toBeInTheDocument();
  });

  it('creates and submits in one go', async () => {
    await fillOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Create & submit' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-d/submit'));
    expect(await screen.findByRole('heading', { name: 'AFRI-0101' })).toBeInTheDocument();
  });

  it('keeps the draft and opens it when submitting fails', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders') return { id: 'po-d', number: 'AFRI-0101' };
      throw { code: 'INVALID_STATE', message: 'Not allowed' };
    });
    await fillOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Create & submit' }));
    expect(await screen.findByText('Saved as a draft, but not submitted')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'AFRI-0101' })).toBeInTheDocument();
  });

  it('is closed to those who cannot raise orders', async () => {
    auth.roles = ['APPROVER'];
    appAt('/purchase-orders/new');
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Purchase orders' })).toBeInTheDocument();
  });
});

describe('Submitting a draft from its page', () => {
  it('asks first, warns about unpriced lines, and submits', async () => {
    appAt('/purchase-orders/po-d');
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    expect(screen.getAllByText(/1 line has no price yet; it can't be approved until every line is priced/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-d/submit', {}));
  });

  it('is not offered to an approver, or once the order is submitted', async () => {
    auth.roles = ['APPROVER'];
    const { unmount } = appAt('/purchase-orders/po-d');
    await screen.findByText('Item l-1');
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
    unmount();
    auth.roles = ['PROCUREMENT'];
    appAt('/purchase-orders/po-p');
    await screen.findByText('Item l-1');
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
  });

  it('Edit opens the edit page, which goes back to the order on save', async () => {
    appAt('/purchase-orders/po-d');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit AFRI-0101' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'AFRI-0101' })).toBeInTheDocument();
  });

  it('the edit page says when an order can no longer be edited', async () => {
    appAt('/purchase-orders/po-r/edit');
    expect(await screen.findByText('This order can no longer be edited')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });
});

describe('Finding drafts in the list', () => {
  it('opens a buyer on drafts and orders awaiting approval', async () => {
    appAt('/purchase-orders');
    expect(await screen.findByText('AFRI-0101')).toBeInTheDocument();
    expect(screen.getByText('AFRI-0102')).toBeInTheDocument();
    expect(screen.queryByText('AFRI-0103')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter by status')).toHaveValue('DRAFT,PENDING_APPROVAL');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('AFRI-0103')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by status')).toHaveValue('');
  });

  it('opens everyone else on all statuses', async () => {
    auth.roles = ['STORE_CONTROLLER'];
    appAt('/purchase-orders');
    expect(await screen.findByText('AFRI-0104')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New purchase order' })).not.toBeInTheDocument();
  });

  it('takes the status from the link', async () => {
    appAt('/purchase-orders?status=DRAFT');
    expect(await screen.findByText('AFRI-0101')).toBeInTheDocument();
    expect(screen.queryByText('AFRI-0102')).not.toBeInTheDocument();
  });
});
