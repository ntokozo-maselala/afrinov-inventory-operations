// The order says which project its material is for (Project on the Order
// Roadmap, Phase 2): any Projects item is offered on a project order, an item's
// tagged project only suggests the order's project, and Order shows on any
// active Projects item. (Before, materials sections roadmap Phase 6, the item's
// project fixed the order's and other projects' material wasn't offered.)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Thandi Buyer', roles: ['PROCUREMENT'] } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { NewPurchaseOrder } = await import('./PurchaseOrderForm');
const { MaterialDetail } = await import('./MaterialDetail');
const { ToastProvider } = await import('../components/Toast');

const pipe = (id: string, projectNumber: string, status = 'ACTIVE') => ({
  id, sku: `${projectNumber}-PIPE`, name: `Pipe for ${projectNumber}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', requiredStock: '0',
  unitCost: '100', active: true, projectNumber, project: { projectNumber, name: `Job ${projectNumber}`, status },
});
const MATERIALS = [
  { id: 'm-1', sku: 'DISC', name: 'Cutting disc', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '10', unitCost: '12.5', active: true },
  pipe('p-1369', '1369'), pipe('p-1402', '1402'), pipe('p-1200', '1200', 'COMPLETED'),
];
const PROJECTS = [
  { projectNumber: '1369', name: 'Plant upgrade', active: true, status: 'ACTIVE' },
  { projectNumber: '1402', name: 'Boiler', active: true, status: 'PLANNING' },
  { projectNumber: '1200', name: 'Old job', active: true, status: 'COMPLETED' },
];

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* not available */ }
  mockPost.mockReset().mockResolvedValue({ id: 'po-1', number: 'AFRI-0001' });
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/suppliers') return [{ id: 's-1', name: 'Hydac', active: true, currency: 'ZAR', paymentTerms: null }];
    if (path === '/materials') return MATERIALS;
    if (path.startsWith('/materials/')) return MATERIALS.find((m) => m.id === path.slice('/materials/'.length));
    if (path.startsWith('/projects')) return PROJECTS;
    if (path.startsWith('/settings/values')) return { 'purchaseOrders.vatRate': 15 };
    return [];
  });
});

const form = (query = '') => render(
  <MemoryRouter initialEntries={[`/purchase-orders/new${query}`]}>
    <ToastProvider><Routes><Route path="/purchase-orders/new" element={<NewPurchaseOrder />} /></Routes></ToastProvider>
  </MemoryRouter>,
);
const optionsOf = (label: string) => within(screen.getByLabelText(label)).getAllByRole('option').map((o) => o.textContent);

describe('the new-order form with project material', () => {
  it('suggests the project from an item tagged with one, without locking it, and offers every Projects item', async () => {
    form('?materialIds=p-1369');
    expect(await screen.findByLabelText('Line 1 material')).toHaveValue('p-1369');
    await waitFor(() => expect(screen.getByLabelText('Project')).toHaveValue('1369'));
    expect(screen.getByLabelText('Project')).toBeEnabled();
    expect(screen.queryByText(/Set by 1369-PIPE/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const line2 = optionsOf('Line 2 material');
    // Procurement buys for projects: Stores items are the store's to order (Stores ordering roadmap).
    expect(line2).not.toContain('DISC — Cutting disc');
    // Another project's item, and a closed project's: the order says which project it is for.
    expect(line2).toContain('1402-PIPE — Pipe for 1402');
    expect(line2).toContain('1200-PIPE — Pipe for 1200');

    // The buyer may order it for another project.
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '1402' } });
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({
      projectNumber: '1402', lines: [expect.objectContaining({ materialId: 'p-1369', orderedQty: 4 })],
    })));
  });

  it("doesn't suggest a closed project, or replace the project already chosen", async () => {
    form();
    await waitFor(() => expect(optionsOf('Project')).toContain('1402 — Boiler'));
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'p-1200' } });
    expect(screen.getByLabelText('Project')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '1402' } });
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: 'p-1369' } });
    expect(screen.getByLabelText('Project')).toHaveValue('1402');
  });

  // Stores ordering roadmap: Procurement buys for one project.
  it('needs its project before it saves, and adds a new item with no project of its own', async () => {
    form();
    await waitFor(() => expect(optionsOf('Project')).toContain('1369 — Plant upgrade'));
    expect(optionsOf('Project')).not.toContain('No project');
    // A closed project isn't one to order for.
    expect(optionsOf('Project')).not.toContain('1200 — Old job');
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Choose the project this order is for.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    // New item opens before a project is chosen: the item gets none, the order says which.
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    const drawer = await screen.findByRole('dialog', { name: 'New item' });
    expect(within(drawer).getByText(/added as a Projects item, and goes on line 1; this order says which project it is for/)).toBeInTheDocument();
    expect(within(drawer).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(drawer).queryByLabelText('Project')).not.toBeInTheDocument();
  });
});

describe('Order on a project item', () => {
  const item = (id: string) => render(
    <MemoryRouter initialEntries={[`/materials/${id}`]}>
      <ToastProvider><Routes><Route path="/materials/:id" element={<MaterialDetail />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );

  it('opens the form on the item', async () => {
    item('p-1369');
    expect(await screen.findByRole('link', { name: 'Order' })).toHaveAttribute('href', '/purchase-orders/new?materialIds=p-1369');
  });

  it('is offered for an item tagged with a closed project too: the order says which project', async () => {
    item('p-1200');
    expect(await screen.findByRole('link', { name: 'Order' })).toHaveAttribute('href', '/purchase-orders/new?materialIds=p-1200');
  });
});
