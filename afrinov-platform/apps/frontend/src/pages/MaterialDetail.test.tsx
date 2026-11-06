import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPatch, perms } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPatch: vi.fn(), perms: { manage: true } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, patch: mockPatch },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({
  useCanManageMaterials: () => perms.manage,
  useHasRole: () => perms.manage,
  usePermissions: () => ({ hasPermission: () => perms.manage }),
}));

const { MaterialDetail } = await import('./MaterialDetail');
const { ToastProvider } = await import('../components/Toast');

const DISC = {
  id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', category: 'CONSUMABLES', unitOfMeasure: 'each',
  requiredStock: '100.0000', unitCost: '12.5000', description: 'Thin', active: true, serialNumber: null,
};
const STOCK = [{ materialId: 'm-1', materialSku: 'DISC-115', materialName: 'Cutting disc', locationId: 'l-1', locationName: 'A-1', locationType: 'STOREROOM', unitOfMeasure: 'each', quantity: '30', requiredStock: '100', stockStatus: 'WARNING', percentOfRequired: 30 }];

let material: Record<string, unknown>;
let stock: unknown[];
/** What the deactivation check finds; none unless a test says so. */
let blockers: unknown[] = [];
// The active projects, which say whether stock held for one can still be issued.
let projects: unknown[] = [{ projectNumber: 'AFRI-1325', status: 'ACTIVE' }];

function renderPage() {
  mockGet.mockImplementation(async (path: string) => {
    if (path.endsWith('/deactivation-check')) return { blockers };
    if (path.startsWith('/materials/')) return material;
    if (path.startsWith('/reports/current-stock')) return stock;
    if (path.startsWith('/projects')) return projects;
    if (path.startsWith('/settings/values')) return {};
    return [];
  });
  render(
    <MemoryRouter initialEntries={['/materials/m-1']}>
      <ToastProvider>
        <Routes><Route path="/materials/:id" element={<MaterialDetail />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const gets = (prefix: string) => mockGet.mock.calls.filter(([p]) => String(p).startsWith(prefix)).length;

describe('MaterialDetail editing', () => {
  beforeEach(() => {
    perms.manage = true;
    material = { ...DISC };
    stock = STOCK;
    blockers = [];
    mockGet.mockReset();
    mockPatch.mockReset().mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...material, ...body }));
  });

  it('edits the required stock and clears the unit cost, then reloads the item and its stock', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText(/SKU/)).toBeDisabled();
    expect(screen.getByLabelText(/Category/)).toBeDisabled();
    expect(screen.getByLabelText(/Required stock/)).toHaveValue('100');
    expect(screen.getByLabelText(/Unit cost/)).toHaveValue(12.5);

    fireEvent.change(screen.getByLabelText(/Required stock/), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/Unit cost/), { target: { value: '' } });
    const before = { item: gets('/materials/'), stock: gets('/reports/current-stock') };
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith('/materials/m-1', {
      name: 'Cutting disc', unitOfMeasure: 'each', requiredStock: 40, unitCost: null, description: 'Thin', trackUse: false,
    });
    expect(await screen.findByText('DISC-115 saved')).toBeInTheDocument();
    await waitFor(() => expect(gets('/materials/')).toBeGreaterThan(before.item));
    expect(gets('/reports/current-stock')).toBeGreaterThan(before.stock);
  });

  it('sends the serial number only for a tool', async () => {
    material = { ...DISC, category: 'TOOLS', serialNumber: 'SN-1' };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/Serial number/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch.mock.calls[0]![1]).toMatchObject({ serialNumber: null });
  });

  it('refuses a negative required stock without calling the server', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/Required stock/), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Required stock must be 0 or positive.')).toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('shows a missing price and offers to set it', async () => {
    material = { ...DISC, unitCost: null };
    renderPage();
    expect(await screen.findByText(/No price/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set one' }));
    expect(screen.getByLabelText(/Unit cost/)).toHaveValue(null);
  });

  it('asks why before deactivating, and sends the reason', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByText('Choose a reason.')).toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'SUPERSEDED' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/materials/m-1/status', { active: false, reasonCode: 'SUPERSEDED' }));
    expect(await screen.findByText('DISC-115 deactivated')).toBeInTheDocument();
  });

  it('lists what is in the way instead of asking why, with no way round it', async () => {
    blockers = [
      { kind: 'STOCK', text: '30 each on hand at Rack A' },
      { kind: 'ORDER', text: 'Order PO-7: 20 each still owed', orderId: 'po-7', projectNumber: null },
    ];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('DISC-115 is not clear yet')).toBeInTheDocument();
    expect(within(dialog).getByText('30 each on hand at Rack A')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open order' })).toHaveAttribute('href', '/stock/orders/po-7');
    expect(within(dialog).getByRole('link', { name: 'See stock' })).toHaveAttribute('href', '/stock?q=DISC-115');
    expect(within(dialog).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Reason/)).not.toBeInTheDocument();
  });

  it('shows why a refused deactivation failed, and lists the items again', async () => {
    mockPatch.mockRejectedValueOnce({ code: 'CONFLICT', message: 'DISC-115 is not clear yet: 1 each on hand at Rack A' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(/Reason/), { target: { value: 'OBSOLETE' } });
    blockers = [{ kind: 'STOCK', text: '1 each on hand at Rack A' }];
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('DISC-115 is not clear yet: 1 each on hand at Rack A')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'See stock' })).toBeInTheDocument();
  });

  it('asks for a note when the reason is Other', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'OTHER' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByText('Add a note saying why.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Range withdrawn' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/materials/m-1/status', { active: false, reasonCode: 'OTHER', note: 'Range withdrawn' }));
  });

  it('asks why before reactivating too, with the reasons for that', async () => {
    material = { ...DISC, active: false };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('option', { name: 'Stock came back' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: 'Obsolete' })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'BACK_IN_USE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/materials/m-1/status', { active: true, reasonCode: 'BACK_IN_USE' }));
  });

  it('offers no changes to someone who cannot manage materials', async () => {
    perms.manage = false;
    material = { ...DISC, unitCost: null };
    renderPage();
    expect(await screen.findByText(/No price/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set one' })).not.toBeInTheDocument();
  });
});

describe('MaterialDetail links', () => {
  beforeEach(() => {
    perms.manage = true;
    material = { ...DISC };
    stock = STOCK;
    blockers = [];
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  const href = (name: string | RegExp) => screen.getByRole('link', { name }).getAttribute('href');

  it('opens Stock on this item, Receive and Issue with it chosen, and its full history', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Edit' });
    expect(href('View in stock')).toBe('/stock?q=DISC-115');
    expect(href('Receive')).toBe('/stock/receive?materialId=m-1');
    expect(href('Issue')).toBe('/stock/issue?materialId=m-1');
    expect(href(/All movements/)).toMatch(/^\/movements\?report=all&materialId=m-1&from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/);
  });

  it('sends a tool to Tools to be checked out, not to Issue', async () => {
    material = { ...DISC, category: 'TOOLS' };
    renderPage();
    await screen.findByRole('button', { name: 'Edit' });
    expect(href('Check out')).toBe('/tools?q=DISC-115');
    expect(screen.queryByRole('link', { name: 'Issue' })).not.toBeInTheDocument();
  });

  it('offers Receive stock when nothing is on hand, and no Issue', async () => {
    stock = [];
    renderPage();
    expect(await screen.findByText('No stock recorded')).toBeInTheDocument();
    expect(href('Receive stock')).toBe('/stock/receive?materialId=m-1');
    expect(screen.queryByRole('link', { name: 'Issue' })).not.toBeInTheDocument();
  });

  it('offers no Receive or Issue for an inactive item', async () => {
    material = { ...DISC, active: false };
    renderPage();
    await screen.findByRole('button', { name: 'Reactivate' });
    expect(screen.queryByRole('link', { name: 'Receive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Issue' })).not.toBeInTheDocument();
  });
});

// Qodo, PR #142: one location can hold Stores stock and stock held for a
// project, each its own balance, so each line says whose it is.
describe('MaterialDetail stock held for a project', () => {
  beforeEach(() => {
    perms.manage = true;
    material = { ...DISC };
    stock = [...STOCK, { ...STOCK[0]!, quantity: '6', heldForProject: 'AFRI-1325' }];
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  it('lists it on its own line at the location, naming the project', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Stock by location' });
    expect(within(table).getByText('A-1')).toBeInTheDocument();
    expect(within(table).getByText('A-1 · held for AFRI-1325')).toBeInTheDocument();
  });
});

// Project Material Through the Store Roadmap, Phase 2: a Projects item's stock
// received against a project order is that project's, not a leftover.
describe('MaterialDetail Projects item received for a project', () => {
  beforeEach(() => {
    perms.manage = true;
    material = { ...DISC, id: 'm-1', category: 'PROJECT_MATERIAL', projectNumber: null, requiredStock: '0' };
    stock = [{ ...STOCK[0]!, category: 'PROJECT_MATERIAL', quantity: '6', heldForProject: 'AFRI-1325' }];
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  it('lists it as held for the project, and offers no move to Stores', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'In the store for projects' });
    expect(within(table).getByText('AFRI-1325')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Left in the store' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Move to Stores' })).not.toBeInTheDocument();
  });

  // Project Material Through the Store Roadmap, Phase 3: stock held for a
  // project is issued to it, even when the item has no project of its own; the
  // page says the store holds project material (Qodo, PR #143).
  it('offers Issue for stock held for a project, and says the store holds it', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'In the store for projects' });
    expect(await screen.findByRole('link', { name: 'Issue' })).toHaveAttribute('href', '/stock/issue?materialId=m-1');
    expect(screen.getByText(/The store receives it against that order and holds it for that project./)).toBeInTheDocument();
    expect(screen.queryByText(/was received before/)).not.toBeInTheDocument();
  });

  // Qodo, PR #145: Issue only for stock Issue stock can offer.
  it('offers no Issue for held stock at an inactive location, or held for a project that takes no more issues', async () => {
    stock = [{ ...STOCK[0]!, category: 'PROJECT_MATERIAL', quantity: '6', heldForProject: 'AFRI-1325', locationActive: false }];
    renderPage();
    await screen.findByRole('table', { name: 'In the store for projects' });
    await waitFor(() => expect(gets('/projects')).toBeGreaterThan(0));
    expect(screen.queryByRole('link', { name: 'Issue' })).not.toBeInTheDocument();
  });

  it('offers no Issue for stock held for a completed project', async () => {
    projects = [{ projectNumber: 'AFRI-1325', status: 'COMPLETED' }];
    onTestFinished(() => { projects = [{ projectNumber: 'AFRI-1325', status: 'ACTIVE' }]; });
    renderPage();
    await screen.findByRole('table', { name: 'In the store for projects' });
    await waitFor(() => expect(gets('/projects')).toBeGreaterThan(0));
    expect(screen.queryByRole('link', { name: 'Issue' })).not.toBeInTheDocument();
  });

  it('offers Issue for a leftover, and says it was received before', async () => {
    material = { ...material, projectNumber: 'AFRI-1325' };
    stock = [...stock, { ...STOCK[0]!, category: 'PROJECT_MATERIAL', quantity: '2', heldForProject: null }];
    renderPage();
    await screen.findByRole('table', { name: 'Left in the store' });
    expect(screen.getByRole('link', { name: 'Issue' })).toBeInTheDocument();
    expect(screen.getByText(/was received before project material came through the store/)).toBeInTheDocument();
  });

  it('offers no Check out for a tool whose only stock is held for a project', async () => {
    material = { ...DISC, category: 'TOOLS' };
    stock = [{ ...STOCK[0]!, quantity: '1', heldForProject: 'AFRI-1325' }];
    renderPage();
    await screen.findByRole('table', { name: 'Stock by location' });
    expect(screen.queryByRole('link', { name: 'Check out' })).not.toBeInTheDocument();
  });
});
