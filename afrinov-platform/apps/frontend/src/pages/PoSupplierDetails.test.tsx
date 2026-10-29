// The supplier's contact and address on a purchase order, as the template's
// Inputs sheet looks them up: picking a supplier fills them in, and they can
// be changed for that order.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Thandi Buyer', roles: ['PROCUREMENT'] } }) }));

const { NewPurchaseOrder, EditPurchaseOrder } = await import('./PurchaseOrderForm');
const { ToastProvider } = await import('../components/Toast');

const SUPPLIERS = [
  {
    id: 's-1', name: 'Amalgum Welding', vendorCode: 'V001', active: true, currency: 'ZAR', paymentTerms: '30 DAYS NETT',
    contactName: 'Nicole', contactPhone: '011 452 8413', contactEmail: 'nicole@welding.co.za', address: '23 Grader Road\nSpartan Ext 3',
  },
  { id: 's-2', name: 'Fast Flame', vendorCode: 'V003', active: true, currency: 'ZAR', paymentTerms: null, contactName: 'Sean', contactPhone: null, contactEmail: null, address: null },
];
const MATERIALS = [{ id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '0', unitCost: null, active: true }];
const ORDER = {
  id: 'po-1', number: 'AFRI-0001', status: 'DRAFT', projectNumber: 'AFRI-1325', currency: 'ZAR', vatRate: '15', supplier: { id: 's-1', name: 'Amalgum Welding', vendorCode: 'V001' },
  supplierContactName: 'Nicole', supplierContactPhone: '011 452 8413', supplierContactEmail: 'nicole@welding.co.za', supplierAddress: 'Branch 2',
  deliveryMethod: 'DELIVERY', penaltiesApply: false, settlementDiscount: '0',
  lines: [{ id: 'l-1', material: { sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each' }, orderedQty: '2', unitPrice: null, deliveryDate: null }],
};

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* not available */ }
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/suppliers') return SUPPLIERS;
    if (path === '/materials') return MATERIALS;
    if (path === '/purchase-orders/po-1') return ORDER;
    if (path.startsWith('/settings/values')) return { 'purchaseOrders.vatRate': 15 };
    return [];
  });
  mockPost.mockReset().mockResolvedValue({ id: 'po-9', number: 'AFRI-0009' });
  mockPatch.mockReset().mockResolvedValue({});
});

const at = (url: string, path: string, element: ReactElement) => render(
  <MemoryRouter initialEntries={[url]}><ToastProvider><Routes><Route path={path} element={element} /></Routes></ToastProvider></MemoryRouter>,
);
const newOrder = () => at('/purchase-orders/new', '/purchase-orders/new', <NewPurchaseOrder />);
const pick = async (supplierId: string) => {
  await waitFor(() => expect(screen.getByRole('option', { name: /Amalgum Welding/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: supplierId } });
};

describe('the supplier details on a new order', () => {
  it('prefills supplier details when the supplier is supplied by a link', async () => {
    at('/purchase-orders/new?supplierId=s-1', '/purchase-orders/new', <NewPurchaseOrder />);
    expect(await screen.findByLabelText('Contact person')).toHaveValue('Nicole');
    expect(screen.getByLabelText('Phone')).toHaveValue('011 452 8413');
    expect(screen.getByLabelText('Email')).toHaveValue('nicole@welding.co.za');
    expect(screen.getByLabelText('Supplier address')).toHaveValue('23 Grader Road\nSpartan Ext 3');
  });

  it('fills them in from the supplier picked, with its vendor code', async () => {
    newOrder();
    expect(screen.queryByLabelText('Contact person')).not.toBeInTheDocument();
    await pick('s-1');
    expect(screen.getByLabelText('Vendor code')).toHaveValue('V001');
    expect(screen.getByLabelText('Vendor code')).toBeDisabled();
    expect(screen.getByLabelText('Contact person')).toHaveValue('Nicole');
    expect(screen.getByLabelText('Phone')).toHaveValue('011 452 8413');
    expect(screen.getByLabelText('Email')).toHaveValue('nicole@welding.co.za');
    expect(screen.getByLabelText('Supplier address')).toHaveValue('23 Grader Road\nSpartan Ext 3');
    expect(screen.getByRole('link', { name: 'edit the supplier' })).toHaveAttribute('href', '/suppliers/s-1');
  });

  it('fills them in again when the supplier changes, blanks included', async () => {
    newOrder();
    await pick('s-1');
    await pick('s-2');
    expect(screen.getByLabelText('Contact person')).toHaveValue('Sean');
    expect(screen.getByLabelText('Phone')).toHaveValue('');
    expect(screen.getByLabelText('Supplier address')).toHaveValue('');
  });

  it('replaces buyer overrides on a supplier change and keeps the delivery address separate', async () => {
    newOrder();
    await pick('s-1');
    fireEvent.change(screen.getByLabelText('Contact person'), { target: { value: 'Order contact' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'branch@example.com' } });
    fireEvent.change(screen.getByLabelText('Supplier address'), { target: { value: 'Branch 2' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'Deliver to the plant' } });
    await pick('s-2');
    expect(screen.getByLabelText('Contact person')).toHaveValue('Sean');
    expect(screen.getByLabelText('Phone')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Supplier address')).toHaveValue('');
    expect(screen.getByLabelText('Address')).toHaveValue('Deliver to the plant');
    await pick('s-1');
    expect(screen.getByLabelText('Contact person')).toHaveValue('Nicole');
    expect(screen.getByLabelText('Email')).toHaveValue('nicole@welding.co.za');
    expect(screen.getByLabelText('Supplier address')).toHaveValue('23 Grader Road\nSpartan Ext 3');
    expect(screen.getByLabelText('Address')).toHaveValue('Deliver to the plant');
  });

  it('saves them as changed for this order, a cleared one as none', async () => {
    newOrder();
    await pick('s-1');
    fireEvent.change(screen.getByLabelText('Contact person'), { target: { value: 'Andre' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({
      supplierContactName: 'Andre', supplierContactPhone: null, supplierContactEmail: 'nicole@welding.co.za', supplierAddress: '23 Grader Road\nSpartan Ext 3',
    })));
  });

  it('refuses an email that is not one', async () => {
    newOrder();
    await pick('s-1');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nicole-welding.co.za' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/The supplier email "nicole-welding.co.za" is not an email address/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('the supplier email check', () => {
  it('refuses an email longer than an email can be, as the server does', async () => {
    const { checkDetails, draftFromOrder } = await import('../components/PurchaseOrderDetailsFields');
    const long = `${'a'.repeat(310)}@example.com`;
    expect(checkDetails({ ...draftFromOrder({}), supplierContactEmail: long })).toMatch(/longer than an email address can be/);
    expect(checkDetails({ ...draftFromOrder({}), supplierContactEmail: 'a..b@x.co' })).toBeNull();
  });
});

describe('the supplier details when editing an order', () => {
  it('shows explicitly cleared order fields as blank and sends nulls when saved', async () => {
    const get = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (path: string) => path === '/purchase-orders/po-1'
      ? { ...ORDER, supplierContactName: null, supplierContactPhone: null, supplierContactEmail: null, supplierAddress: null }
      : get(path));
    at('/purchase-orders/po-1/edit', '/purchase-orders/:id/edit', <EditPurchaseOrder />);
    expect(await screen.findByLabelText('Contact person')).toHaveValue('');
    for (const label of ['Phone', 'Email', 'Supplier address']) expect(screen.getByLabelText(label)).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/purchase-orders/po-1', expect.objectContaining({
      supplierContactName: null, supplierContactPhone: null, supplierContactEmail: null, supplierAddress: null,
    })));
  });

  it('rejects an invalid supplier email before patching the order', async () => {
    at('/purchase-orders/po-1/edit', '/purchase-orders/:id/edit', <EditPurchaseOrder />);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'orders@@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The supplier email "orders@@example.com" is not an email address.')).toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows the order\'s own, and saves a change to them', async () => {
    at('/purchase-orders/po-1/edit', '/purchase-orders/:id/edit', <EditPurchaseOrder />);
    expect(await screen.findByLabelText('Supplier address')).toHaveValue('Branch 2');
    expect(screen.getByLabelText('Vendor code')).toHaveValue('V001');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'orders@welding.co.za' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/purchase-orders/po-1', expect.objectContaining({
      supplierContactName: 'Nicole', supplierContactEmail: 'orders@welding.co.za', supplierAddress: 'Branch 2',
    })));
  });
});
