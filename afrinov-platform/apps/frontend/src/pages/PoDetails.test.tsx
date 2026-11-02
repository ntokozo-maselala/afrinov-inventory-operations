// The order details from the AFRI-0000_x template's Inputs sheet
// (procurement roadmap Phase 3): project, terms, penalties, the delivery
// block, the Afrinov contact and a delivery date per line.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Thandi Buyer', roles: ['PROCUREMENT'] } }) }));

const { PurchaseOrders } = await import('./PurchaseOrders');
const { PurchaseOrderDetail, isLate } = await import('./PurchaseOrderDetail');
const { ToastProvider } = await import('../components/Toast');
const { NewPurchaseOrder, EditPurchaseOrder } = await import('./PurchaseOrderForm');

const SUPPLIERS = [{ id: 's-1', name: 'Hydac', vendorCode: 'V006', active: true, currency: 'ZAR', paymentTerms: '30 DAYS NETT' }];
const MATERIALS = [{ id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', category: 'PROJECT_MATERIAL', unitOfMeasure: 'each', requiredStock: '0', unitCost: null, active: true, projectNumber: 'M-1325', project: { projectNumber: 'M-1325', name: 'Plant upgrade', status: 'ACTIVE' } }];
const PROJECTS = [{ projectNumber: 'M-1325', name: 'Plant upgrade', active: true }];
const SETTINGS = {
  'purchaseOrders.vatRate': 15, 'purchaseOrders.deliveryTo': 'Afrinov (PTY) Ltd',
  'purchaseOrders.deliveryAddress': '10 Lime Street, Icon Industrial Park\nSunderland Ridge, Centurion 0157',
  'purchaseOrders.deliveryCountry': 'South Africa', 'purchaseOrders.deliveryContactName': 'Site storeman', 'purchaseOrders.deliveryContactPhone': '011 000 0000',
};

const line = (over: Record<string, unknown> = {}) => ({
  id: 'l-1', materialId: 'm-1', material: { sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each' },
  orderedQty: '10', receivedQty: '4', unitPrice: null, subtotal: null, vat: null, net: null, deliveryDate: '2026-01-05', ...over,
});
const ORDER = {
  id: 'po-1', number: 'PO-2026-0001', status: 'APPROVED', supplierId: 's-1', supplier: { name: 'Hydac' }, createdAt: '2026-01-01T08:00:00Z',
  currency: 'ZAR', vatRate: '15', totals: { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 1 },
  projectNumber: 'M-1325', project: { projectNumber: 'M-1325', name: 'Plant upgrade' },
  paymentTerms: '30 DAYS NETT', paymentMilestone: null, settlementDiscount: '2.5', shippingTerms: 'Delivered to site', penaltiesApply: true,
  deliveryMethod: 'DELIVERY', deliveryTo: 'Afrinov (PTY) Ltd', deliveryAddress: '10 Lime Street', deliveryCountry: 'South Africa',
  deliveryContactName: 'Site storeman', deliveryContactPhone: '011 000 0000', afrinovContact: 'Thandi Buyer',
  expectedDeliveryDate: '2026-01-10', lines: [line()],
};
const OTHER = { ...ORDER, id: 'po-2', number: 'PO-2026-0002', projectNumber: 'M-2001', project: { projectNumber: 'M-2001', name: 'Second job' } };
// The store's own order: no project (Stores ordering roadmap).
const STORES = { ...ORDER, id: 'po-3', number: 'PO-2026-0003', projectNumber: null, project: null };

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders?kind=projects') return [ORDER, OTHER, STORES];
    if (path === '/purchase-orders/po-1') return ORDER;
    if (path.endsWith('/approval')) return { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 1, currency: 'ZAR', canApprove: false, reason: null, myLimit: null, approvers: [] };
    if (path.startsWith('/purchase-orders/')) return [];
    if (path === '/suppliers') return SUPPLIERS;
    if (path === '/materials') return MATERIALS;
    if (path.startsWith('/projects')) return PROJECTS;
    if (path.startsWith('/settings/values')) return SETTINGS;
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
const listPage = (url = '/purchase-orders') => appAt(url);
const detailPage = () => appAt('/purchase-orders/po-1');

describe('New purchase order: the template details', () => {
  async function openForm() {
    appAt('/purchase-orders/new');
    await waitFor(() => expect(screen.getByLabelText('Deliver to')).toHaveValue('Afrinov (PTY) Ltd'));
  }

  it('starts from the defaults: Settings delivery block, supplier terms, the buyer as contact', async () => {
    await openForm();
    expect(screen.getByLabelText('Address')).toHaveValue('10 Lime Street, Icon Industrial Park\nSunderland Ridge, Centurion 0157');
    expect(screen.getByLabelText('Contact at delivery address')).toHaveValue('Site storeman');
    expect(screen.getByLabelText('Afrinov contact')).toHaveValue('Thandi Buyer');
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    expect(screen.getByLabelText('Payment terms')).toHaveValue('30 DAYS NETT');
  });

  it('sends the project, terms, penalties and a line delivery date', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    await screen.findByRole('option', { name: 'M-1325 — Plant upgrade' });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'M-1325' } });
    fireEvent.change(screen.getByLabelText('Shipping terms'), { target: { value: 'Delivered to site' } });
    fireEvent.change(screen.getByLabelText('Settlement discount (%)'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Penalties'), { target: { value: 'yes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Line 1 delivery date'), { target: { value: '2026-11-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & submit' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({
      projectNumber: 'M-1325', paymentTerms: '30 DAYS NETT', shippingTerms: 'Delivered to site', settlementDiscount: 2.5,
      penaltiesApply: true, deliveryMethod: 'DELIVERY', deliveryTo: 'Afrinov (PTY) Ltd', afrinovContact: 'Thandi Buyer',
      // The only line's date is the latest, so it is the order's expected delivery, which the line follows.
      expectedDeliveryDate: '2026-11-02',
      lines: [{ materialId: 'm-1', orderedQty: 4 }],
    })));
  });

  it('drops the delivery address when Afrinov collects', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Collection by Afrinov' }));
    expect(screen.queryByLabelText('Deliver to')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Contact for collection')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & submit' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ deliveryMethod: 'COLLECTION' });
    expect(body.deliveryTo).toBeUndefined();
    expect(body.deliveryAddress).toBeUndefined();
  });

  it('refuses a settlement discount over 100', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Settlement discount (%)'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & submit' }));
    expect(await screen.findByText('Settlement discount must be between 0 and 100.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Purchase orders list by project', () => {
  it('opens on one project from the link, and can be cleared', async () => {
    listPage('/purchase-orders?project=M-1325');
    expect(await screen.findByText('PO-2026-0001')).toBeInTheDocument();
    expect(screen.queryByText('PO-2026-0002')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter by project')).toHaveValue('M-1325');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('PO-2026-0002')).toBeInTheDocument();
  });

  // Stores and Procurement Separation Roadmap: the store's orders are kept in Order stock.
  it('lists project orders only, with no way to the store\'s', async () => {
    listPage('/purchase-orders?status=all');
    expect(await screen.findByText('PO-2026-0001')).toBeInTheDocument();
    // Even were the server to answer one, a Stores order isn't listed.
    expect(screen.queryByText('PO-2026-0003')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by kind of order')).not.toBeInTheDocument();
  });
});

describe('Purchase order detail: the template details', () => {
  it('shows the order details and delivery block, with the project linking to its orders', async () => {
    detailPage();
    const project = await screen.findByRole('link', { name: 'M-1325 — Plant upgrade' });
    expect(project).toHaveAttribute('href', '/purchase-orders?project=M-1325');
    for (const text of ['30 DAYS NETT', 'Delivered to site', '2.5%', 'Apply to this order', 'Site storeman, 011 000 0000']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('marks a line still owed after its delivery date as late', async () => {
    detailPage();
    const row = (await screen.findByText('Cutting disc')).closest('tr')!;
    expect(within(row).getByText('Late')).toBeInTheDocument();
  });

  it('edits details and a line date, sending only the dates that changed and null for a cleared field', async () => {
    detailPage();
    await screen.findByText('Cutting disc');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Shipping terms'), { target: { value: '' } });
    // Later than the expected delivery (10 January), so it becomes the order's, which the line follows.
    fireEvent.change(screen.getByLabelText('DISC-115 delivery date'), { target: { value: '2026-02-01' } });
    expect(screen.getByLabelText('Expected delivery')).toHaveValue('2026-02-01');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    expect(mockPatch.mock.calls[0]![1]).toMatchObject({
      shippingTerms: null, projectNumber: 'M-1325', penaltiesApply: true, expectedDeliveryDate: '2026-02-01',
      lineDeliveryDates: [{ lineId: 'l-1', deliveryDate: null }],
    });
  });
});

describe('line delivery dates follow the expected delivery', () => {
  it('fills each line with the expected delivery until the line is given its own date', async () => {
    appAt('/purchase-orders/new');
    await waitFor(() => expect(screen.getByLabelText('Deliver to')).toHaveValue('Afrinov (PTY) Ltd'));
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('Expected delivery'), { target: { value: '2026-11-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(screen.getByLabelText('Line 1 delivery date')).toHaveValue('2026-11-10');
    expect(screen.getByLabelText('Line 2 delivery date')).toHaveValue('2026-11-10');

    // An earlier line date is the line's own; the order's stays the latest.
    fireEvent.change(screen.getByLabelText('Line 1 delivery date'), { target: { value: '2026-11-05' } });
    expect(screen.getByLabelText('Expected delivery')).toHaveValue('2026-11-10');

    for (const n of [1, 2]) {
      fireEvent.change(screen.getByLabelText(`Line ${n} material`), { target: { value: 'm-1' } });
      fireEvent.change(screen.getByLabelText(`Line ${n} quantity`), { target: { value: '1' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0]![1]).toMatchObject({
      expectedDeliveryDate: '2026-11-10',
      lines: [{ materialId: 'm-1', orderedQty: 1, deliveryDate: '2026-11-05' }, { materialId: 'm-1', orderedQty: 1 }],
    });
  });

  // The order's expected delivery is always its latest line's date, and changing one line never moves another.
  it('keeps the expected delivery on the latest line date, as lines are changed or removed', async () => {
    appAt('/purchase-orders/new');
    await waitFor(() => expect(screen.getByLabelText('Deliver to')).toHaveValue('Afrinov (PTY) Ltd'));
    fireEvent.change(screen.getByLabelText('Expected delivery'), { target: { value: '2026-11-11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    // A later date on line 2 moves the order's; line 1 keeps the date it showed.
    fireEvent.change(screen.getByLabelText('Line 2 delivery date'), { target: { value: '2026-11-13' } });
    expect(screen.getByLabelText('Expected delivery')).toHaveValue('2026-11-13');
    expect(screen.getByLabelText('Line 1 delivery date')).toHaveValue('2026-11-11');
    // Moved back, the latest is now 12 November.
    fireEvent.change(screen.getByLabelText('Line 2 delivery date'), { target: { value: '2026-11-12' } });
    expect(screen.getByLabelText('Expected delivery')).toHaveValue('2026-11-12');
    expect(screen.getByLabelText('Line 1 delivery date')).toHaveValue('2026-11-11');
    // The latest line removed, the order's is the next latest.
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }));
    expect(screen.getByLabelText('Expected delivery')).toHaveValue('2026-11-11');
    expect(screen.getByLabelText('Line 1 delivery date')).toHaveValue('2026-11-11');
  });

  // Qodo, PR #133: typing a date fires a change for each part-typed value (year 0002, 0020, …).
  it('aligns a typed expected delivery only once it is committed, so part-typed dates never land on the lines', async () => {
    appAt('/purchase-orders/new');
    await waitFor(() => expect(screen.getByLabelText('Deliver to')).toHaveValue('Afrinov (PTY) Ltd'));
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('Expected delivery'), { target: { value: '2026-11-10' } });
    fireEvent.blur(screen.getByLabelText('Expected delivery'));
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 2 delivery date'), { target: { value: '2026-11-20' } });
    expect(screen.getByLabelText('Expected delivery')).toHaveValue('2026-11-20');

    // Line 1 keeps the 10th it showed; line 2, on the latest date, follows the order's.
    expect(screen.getByLabelText('Line 1 delivery date')).toHaveValue('2026-11-10');

    // Part-typed: the field shows what is typed, line 2 follows it, and line 1 keeps its own date.
    const field = screen.getByLabelText('Expected delivery');
    for (const v of ['0002-11-15', '0020-11-15', '0202-11-15', '2026-11-15']) {
      fireEvent.change(field, { target: { value: v } });
      expect(field).toHaveValue(v);
      expect(screen.getByLabelText('Line 1 delivery date')).toHaveValue('2026-11-10');
      expect(screen.getByLabelText('Line 2 delivery date')).toHaveValue(v);
    }
    // Committed: still the latest, so nothing moves.
    fireEvent.blur(field);
    expect(field).toHaveValue('2026-11-15');
    expect(screen.getByLabelText('Line 1 delivery date')).toHaveValue('2026-11-10');
    expect(screen.getByLabelText('Line 2 delivery date')).toHaveValue('2026-11-15');

    // Saved straight from the field, without leaving it: aligned on saving.
    fireEvent.change(field, { target: { value: '2026-11-05' } });
    for (const n of [1, 2]) {
      fireEvent.change(screen.getByLabelText(`Line ${n} material`), { target: { value: 'm-1' } });
      fireEvent.change(screen.getByLabelText(`Line ${n} quantity`), { target: { value: '1' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    // The 5th is earlier than line 1's 10th: line 2 keeps the 5th it showed, and the order's is the 10th.
    expect(mockPost.mock.calls[0]![1]).toMatchObject({
      expectedDeliveryDate: '2026-11-10',
      lines: [{ materialId: 'm-1', orderedQty: 1 }, { materialId: 'm-1', orderedQty: 1, deliveryDate: '2026-11-05' }],
    });
    expect(mockPost.mock.calls[0]![1].lines[0]).not.toHaveProperty('deliveryDate');
  });

  it('on Edit, a line set back to the expected delivery follows it again', async () => {
    appAt('/purchase-orders/po-1/edit');
    const date = await screen.findByLabelText('DISC-115 delivery date');
    expect(date).toHaveValue('2026-01-05');
    fireEvent.change(date, { target: { value: '2026-01-10' } }); // the order's expected delivery
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    expect(mockPatch.mock.calls[0]![1]).toMatchObject({ lineDeliveryDates: [{ lineId: 'l-1', deliveryDate: null }] });
  });
});

describe('isLate', () => {
  const po = { status: 'APPROVED' as const, expectedDeliveryDate: '2026-03-01' };
  it('uses the line date, or the order date when the line has none', () => {
    expect(isLate(line({ deliveryDate: '2026-02-01' }), po, '2026-02-15')).toBe(true);
    expect(isLate(line({ deliveryDate: null }), po, '2026-02-15')).toBe(false);
    expect(isLate(line({ deliveryDate: null }), po, '2026-03-02')).toBe(true);
  });
  it('is never late once received in full, or on an order that cannot be received', () => {
    expect(isLate(line({ receivedQty: '10' }), po, '2026-12-01')).toBe(false);
    expect(isLate(line(), { ...po, status: 'CLOSED' as const }, '2026-12-01')).toBe(false);
  });
});
