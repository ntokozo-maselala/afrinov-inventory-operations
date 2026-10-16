import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

function renderPage() {
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/materials/')) return material;
    if (path.startsWith('/reports/current-stock')) return stock;
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
    mockGet.mockReset();
    mockPatch.mockReset().mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...material, ...body }));
  });

  it('edits the required stock and clears the unit cost, then reloads the item and its stock', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText(/SKU/)).toBeDisabled();
    expect(screen.getByLabelText(/Category/)).toBeDisabled();
    expect(screen.getByLabelText(/Reorder level/)).toHaveValue(100);
    expect(screen.getByLabelText(/Unit cost/)).toHaveValue(12.5);

    fireEvent.change(screen.getByLabelText(/Reorder level/), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/Unit cost/), { target: { value: '' } });
    const before = { item: gets('/materials/'), stock: gets('/reports/current-stock') };
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith('/materials/m-1', {
      name: 'Cutting disc', unitOfMeasure: 'each', requiredStock: 40, unitCost: null, description: 'Thin',
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

  it('refuses a negative reorder level without calling the server', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/Reorder level/), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Reorder level must be 0 or positive.')).toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('shows a missing price and offers to set it', async () => {
    material = { ...DISC, unitCost: null };
    renderPage();
    expect(await screen.findByText(/No price/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set one' }));
    expect(screen.getByLabelText(/Unit cost/)).toHaveValue(null);
  });

  it('warns about stock on hand before deactivating', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect((await screen.findAllByText(/30 each is still on hand/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' }).at(-1)!);
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/materials/m-1', { active: false }));
    expect(await screen.findByText('DISC-115 deactivated')).toBeInTheDocument();
  });

  it('reactivates an inactive item without asking', async () => {
    material = { ...DISC, active: false };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/materials/m-1', { active: true }));
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
