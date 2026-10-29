// Project material is ordered only for its own project (materials sections
// roadmap, Phase 6): it sets the order's project, other projects' material is
// not offered, and a completed or cancelled project's material isn't ordered.
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
  it('sets the project from its material, locks it, and offers no other project\'s material', async () => {
    form('?materialIds=p-1369');
    expect(await screen.findByLabelText('Line 1 material')).toHaveValue('p-1369');
    await waitFor(() => expect(screen.getByLabelText('Project')).toHaveValue('1369'));
    expect(screen.getByLabelText('Project')).toBeDisabled();
    expect(screen.getByText(/Set by 1369-PIPE: project material is ordered only for its own project/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const line2 = optionsOf('Line 2 material');
    // Procurement buys for projects: Stores items are the store's to order (Stores ordering roadmap).
    expect(line2).not.toContain('DISC — Cutting disc');
    expect(line2).not.toContain('1402-PIPE — Pipe for 1402');

    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({
      projectNumber: '1369', lines: [expect.objectContaining({ materialId: 'p-1369', orderedQty: 4 })],
    })));
  });

  it('frees the project once its material is removed', async () => {
    form('?materialIds=p-1369');
    await waitFor(() => expect(screen.getByLabelText('Project')).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 1' }));
    expect(screen.getByLabelText('Project')).toBeEnabled();
    expect(screen.getByLabelText('Project')).toHaveValue('');
  });

  it('offers only the chosen project\'s material once a project is picked', async () => {
    form();
    await waitFor(() => expect(optionsOf('Project')).toContain('1402 — Boiler'));
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '1402' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const line1 = optionsOf('Line 1 material');
    expect(line1).toContain('1402-PIPE — Pipe for 1402');
    expect(line1).not.toContain('1369-PIPE — Pipe for 1369');
    expect(line1).not.toContain('DISC — Cutting disc');
  });

  // Stores ordering roadmap: Procurement buys for one project.
  it('needs its project before it saves, and offers + New item once it has one', async () => {
    form();
    await waitFor(() => expect(optionsOf('Project')).toContain('1369 — Plant upgrade'));
    expect(optionsOf('Project')).not.toContain('No project');
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    // Offered, but a Projects item needs the order's project first.
    expect(optionsOf('Line 1 material')).toContain('+ New item…');
    fireEvent.change(screen.getByLabelText('Line 1 material'), { target: { value: '__new_item__' } });
    expect(await screen.findByText('Choose the project first')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Supplier(?! address)/), { target: { value: 's-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Choose the project this order is for.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '1369' } });
    // The New item button opens the drawer on a new line, fixed to a Projects item for 1369.
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    const drawer = await screen.findByRole('dialog', { name: 'New item' });
    expect(within(drawer).getByRole('radio', { name: /Stores/ })).toBeDisabled();
    expect(within(drawer).getByRole('radio', { name: /Projects/ })).toBeChecked();
    expect(within(drawer).getByLabelText('Project')).toHaveValue('1369');
    expect(within(drawer).getByLabelText('Project')).toBeDisabled();
  });

  it('offers neither a closed project nor its material', async () => {
    form();
    await waitFor(() => expect(optionsOf('Project')).toContain('1369 — Plant upgrade'));
    expect(optionsOf('Project')).not.toContain('1200 — Old job');
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(optionsOf('Line 1 material')).not.toContain('1200-PIPE — Pipe for 1200');
  });
});

describe('Order on a project item', () => {
  const item = (id: string) => render(
    <MemoryRouter initialEntries={[`/materials/${id}`]}>
      <ToastProvider><Routes><Route path="/materials/:id" element={<MaterialDetail />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );

  it('opens the form on the item, so its project is set', async () => {
    item('p-1369');
    expect(await screen.findByRole('link', { name: 'Order' })).toHaveAttribute('href', '/purchase-orders/new?materialIds=p-1369');
  });

  it('is not offered once the project is closed', async () => {
    item('p-1200');
    await screen.findByText(/Pipe for 1200/);
    expect(screen.queryByRole('link', { name: 'Order' })).not.toBeInTheDocument();
  });
});
