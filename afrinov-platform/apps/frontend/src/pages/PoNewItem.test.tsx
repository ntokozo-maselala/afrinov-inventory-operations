// + New item on a purchase order line: material the client needs that isn't in
// the catalogue yet is added from its line, as a Projects item for the order's
// project when it has one, and goes straight onto that line.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { roles: ['PROCUREMENT'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Thandi Buyer', roles: auth.roles } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { NewPurchaseOrder } = await import('./PurchaseOrderForm');
const { ToastProvider } = await import('../components/Toast');

const MATERIALS = [{ id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '10', unitCost: '12.5', active: true }];
const PROJECTS = [{ projectNumber: '1369', name: 'Plant upgrade', active: true, status: 'ACTIVE' }];
const created = (over: Record<string, unknown> = {}) => ({
  id: 'm-new', sku: '1369-FLANGE-150', name: 'Flange 150NB', category: 'PROJECT_MATERIAL', section: 'PROJECTS', unitOfMeasure: 'each',
  requiredStock: '0', unitCost: '850', active: true, projectNumber: '1369', project: { projectNumber: '1369', name: 'Plant upgrade', status: 'ACTIVE' }, ...over,
});

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  try { sessionStorage.clear(); } catch { /* not available */ }
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/suppliers') return [{ id: 's-1', name: 'Hydac', active: true, currency: 'ZAR' }];
    if (path === '/materials') return MATERIALS;
    if (path.startsWith('/projects')) return PROJECTS;
    if (path.startsWith('/settings/values')) return { 'purchaseOrders.vatRate': 15 };
    return [];
  });
  mockPost.mockReset().mockImplementation(async (path: string) => (path === '/materials' ? created() : { id: 'po-1', number: 'AFRI-0001' }));
});

function renderForm() {
  render(
    <MemoryRouter initialEntries={['/purchase-orders/new']}>
      <ToastProvider><Routes><Route path="/purchase-orders/new" element={<NewPurchaseOrder />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );
}

async function lineWithNewItem() {
  await waitFor(() => expect(screen.getByRole('option', { name: /1369 — Plant upgrade/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
  fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: '__new_item__' } });
  return screen.findByRole('dialog', { name: 'New item' });
}

describe('+ New item on an order line', () => {
  it('adds the item as a Projects item for the order\'s project, and puts it on the line', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole('option', { name: /1369 — Plant upgrade/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '1369' } });
    const drawer = await lineWithNewItem();
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('');
    expect(within(drawer).getByText(/added as a Projects item for 1369, and goes on line 1/)).toBeInTheDocument();
    await waitFor(() => expect(within(drawer).getByRole('combobox', { name: /^Project/ })).toHaveValue('1369'));

    fireEvent.change(within(drawer).getByLabelText(/SKU/), { target: { value: '1369-FLANGE-150' } });
    fireEvent.change(within(drawer).getByLabelText(/Item name/), { target: { value: 'Flange 150NB' } });
    fireEvent.change(within(drawer).getByLabelText(/Unit cost/), { target: { value: '850' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/materials', expect.objectContaining({
      sku: '1369-FLANGE-150', name: 'Flange 150NB', category: 'PROJECT_MATERIAL', projectNumber: '1369',
    })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('m-new');
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue(850);
    // Project material sets the order's project, as any other would.
    expect(screen.getByLabelText('Project')).toBeDisabled();
  });

  it('leaves the line as it was when cancelled', async () => {
    renderForm();
    const drawer = await lineWithNewItem();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('keeps an item made for another project off this order, saying why', async () => {
    mockPost.mockImplementation(async () => created({ projectNumber: '1402', project: { projectNumber: '1402', name: 'Boiler', status: 'ACTIVE' } }));
    renderForm();
    await waitFor(() => expect(screen.getByRole('option', { name: /1369 — Plant upgrade/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '1369' } });
    const drawer = await lineWithNewItem();
    fireEvent.change(within(drawer).getByLabelText(/SKU/), { target: { value: '1402-FLANGE' } });
    fireEvent.change(within(drawer).getByLabelText(/Item name/), { target: { value: 'Flange' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText(/It is for project 1402, and this order is for 1369/)).toBeInTheDocument();
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('');
  });

  // Review: the line kept the price of the item it held before.
  it('takes the price of the new item over one filled from the item the line held, but keeps a typed one', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole('option', { name: /1369 — Plant upgrade/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'm-1' } });
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue(12.5);
    const add = async () => {
      fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: '__new_item__' } });
      const drawer = await screen.findByRole('dialog', { name: 'New item' });
      fireEvent.change(within(drawer).getByLabelText(/SKU/), { target: { value: 'FLANGE' } });
      fireEvent.change(within(drawer).getByLabelText(/Item name/), { target: { value: 'Flange' } });
      fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument());
    };
    mockPost.mockImplementation(async () => created({ id: 'm-new', category: 'CONSUMABLES', section: 'STORES', projectNumber: null, project: null }));
    await add();
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('m-new');
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue(850);

    fireEvent.change(screen.getByLabelText('Line 1 unit price'), { target: { value: '99' } });
    mockPost.mockImplementation(async () => created({ id: 'm-new2', sku: 'FLANGE-2', category: 'CONSUMABLES', section: 'STORES', projectNumber: null, project: null, unitCost: '500' }));
    await add();
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('m-new2');
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue(99);
  });

  // Review: a failed refresh of the catalogue hid the order being typed.
  it('keeps the order on screen when the catalogue fails to refresh after adding', async () => {
    let calls = 0;
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/materials' && ++calls > 1) throw { code: 'INTERNAL_ERROR', message: 'Network down' };
      return base(path);
    });
    renderForm();
    const drawer = await lineWithNewItem();
    fireEvent.change(within(drawer).getByLabelText(/SKU/), { target: { value: '1369-FLANGE-150' } });
    fireEvent.change(within(drawer).getByLabelText(/Item name/), { target: { value: 'Flange 150NB' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('m-new');
  });
});
