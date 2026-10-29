// + New item on a purchase order line: material the client needs that isn't in
// the catalogue yet is added from its line, as a Projects item for the order's
// project, and goes straight onto that line. Procurement buys for projects
// (Stores ordering roadmap), so it is offered once the order has its project.
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

const MATERIALS = [{
  id: 'm-1', sku: '1369-DISC', name: 'Cutting disc', category: 'PROJECT_MATERIAL', unitOfMeasure: 'each', requiredStock: '0', unitCost: '12.5', active: true,
  projectNumber: '1369', project: { projectNumber: '1369', name: 'Plant upgrade', status: 'ACTIVE' },
}];
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
  fireEvent.change(screen.getByLabelText('Project'), { target: { value: '1369' } });
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
    mockPost.mockImplementation(async () => created({ id: 'm-new' }));
    await add();
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('m-new');
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue(850);

    fireEvent.change(screen.getByLabelText('Line 1 unit price'), { target: { value: '99' } });
    mockPost.mockImplementation(async () => created({ id: 'm-new2', sku: 'FLANGE-2', unitCost: '500' }));
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

  // Qodo: the target line was a position, so a save finishing after the drawer closed could land anywhere.
  it('puts an item on no line when its drawer was closed before the save finished', async () => {
    let finish: (v: unknown) => void = () => {};
    mockPost.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderForm();
    const drawer = await lineWithNewItem();
    fireEvent.change(within(drawer).getByLabelText(/SKU/), { target: { value: 'FLANGE' } });
    fireEvent.change(within(drawer).getByLabelText(/Item name/), { target: { value: 'Flange' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument());
    finish(created());
    expect(await screen.findByText('1369-FLANGE-150 added to the catalogue')).toBeInTheDocument();
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('');
  });

  // Qodo: a unit cost of 0 must price the line at 0, not leave it unpriced.
  it('prices the line at 0 for an item whose unit cost is 0', async () => {
    mockPost.mockImplementation(async () => created({ unitCost: '0' }));
    renderForm();
    const drawer = await lineWithNewItem();
    fireEvent.change(within(drawer).getByLabelText(/SKU/), { target: { value: 'FREE-SAMPLE' } });
    fireEvent.change(within(drawer).getByLabelText(/Item name/), { target: { value: 'Free sample' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(screen.getByLabelText('Line 1 material')).toHaveValue('m-new'));
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue(0);
  });

  // Qodo: a save from an earlier opening of the drawer filled the line, and closed the drawer, once it was opened again.
  it('keeps a save from an earlier opening off the line when the drawer was reopened for it', async () => {
    let finish: (v: unknown) => void = () => {};
    mockPost.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderForm();
    const first = await lineWithNewItem();
    fireEvent.change(within(first).getByLabelText(/SKU/), { target: { value: 'FLANGE' } });
    fireEvent.change(within(first).getByLabelText(/Item name/), { target: { value: 'Flange' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Add item' }));
    fireEvent.click(within(first).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: '__new_item__' } });
    const second = await screen.findByRole('dialog', { name: 'New item' });
    expect(within(second).getByLabelText(/SKU/)).toHaveValue('');
    finish(created());
    expect(await screen.findByText('1369-FLANGE-150 added to the catalogue')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('');
  });
});
