// The Materials screens in two sections (materials sections roadmap, Phase 2):
// Stores and Projects tabs, the item form asking the section first, and an
// item's page saying where it belongs. A Projects item has no project of its
// own: the order it is bought on says which (Project on the Order Roadmap,
// Phase 3), so nothing asks for, filters by or warns about one.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({
  useCanManageMaterials: () => true,
  useHasRole: () => true,
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock('../components/RoleGuard', () => ({ RoleGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const { Materials } = await import('./Materials');
const { MaterialDetail } = await import('./MaterialDetail');
const { MaterialForm } = await import('../components/MaterialForm');
const { ToastProvider } = await import('../components/Toast');

const item = (sku: string, over: Record<string, unknown> = {}) => ({
  id: `m-${sku}`, sku, name: `Item ${sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each',
  requiredStock: '10', unitCost: '5.0000', active: true, serialNumber: null, projectNumber: null, project: null, ...over,
});
const projectItem = (sku: string, projectNumber: string | null, name = 'Plant upgrade') =>
  item(sku, { category: 'PROJECT_MATERIAL', requiredStock: '0', projectNumber, project: projectNumber ? { projectNumber, name } : null });
const ITEMS = [item('DISC'), item('DRILL', { category: 'TOOLS' }), projectItem('1369-PIPE', '1369'), projectItem('1402-BOLT', '1402', 'Silo'), projectItem('OLD-PLATE', null)];
const PROJECTS = [
  { projectNumber: '1369', name: 'Plant upgrade', status: 'ACTIVE', active: true },
  { projectNumber: '1402', name: 'Silo', status: 'PLANNING', active: true },
  { projectNumber: '1200', name: 'Done job', status: 'COMPLETED', active: true },
];

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/materials') return ITEMS;
    if (path.startsWith('/materials/')) return ITEMS.find((m) => m.id === path.slice('/materials/'.length));
    if (path.startsWith('/projects')) return PROJECTS;
    if (path.startsWith('/settings/values')) return {};
    return [];
  });
  mockPost.mockReset().mockResolvedValue({ id: 'm-new', sku: 'NEW', name: 'New' });
  mockPatch.mockReset().mockResolvedValue({ id: 'm-OLD-PLATE', sku: 'OLD-PLATE', name: 'Plate' });
});

const list = (url = '/materials') => render(
  <MemoryRouter initialEntries={[url]}><ToastProvider><Routes><Route path="/materials" element={<Materials />} /></Routes></ToastProvider></MemoryRouter>,
);
// The item codes in the table, in order.
const skus = () => within(screen.getByRole('table')).getAllByRole('link').map((a) => a.textContent).filter((t) => t && /^[A-Z0-9-]+$/.test(t));

describe('Materials: Stores and Projects tabs', () => {
  it('opens on Stores, with only Stores items', async () => {
    list();
    await screen.findByText('DISC');
    expect(screen.getByRole('tab', { name: /Stores/ })).toHaveAttribute('aria-selected', 'true');
    expect(skus()).toEqual(['DISC', 'DRILL']);
    expect(screen.queryByRole('option', { name: 'Project Material' })).not.toBeInTheDocument();
  });

  it('shows Projects items with no Project column or filter, and no "needs a project" step', async () => {
    list();
    await screen.findByText('DISC');
    expect(screen.queryByText(/need a project|needs a project/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect([...skus()].sort()).toEqual(['1369-PIPE', '1402-BOLT', 'OLD-PLATE']);
    expect(within(screen.getByRole('table')).queryByText('Project')).not.toBeInTheDocument();
    expect(screen.queryByText('No project yet')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Needs a project/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Reorder')).not.toBeInTheDocument();
  });

  it('opens an older link to one project on the whole Projects tab', async () => {
    list('/materials?section=PROJECTS&project=1402');
    await screen.findByText('1402-BOLT');
    expect([...skus()].sort()).toEqual(['1369-PIPE', '1402-BOLT', 'OLD-PLATE']);
  });

  it('adds an item from the Projects tab as Projects material, with no project to choose', async () => {
    list('/materials?section=PROJECTS');
    await screen.findByText('1369-PIPE');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('radio', { name: /Projects/ })).toBeChecked();
    expect(within(drawer).queryByLabelText(/^Project(?!s)/)).not.toBeInTheDocument();
  });
});

const form = (props: Record<string, unknown> = {}) => render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} {...props} />);
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('the item form asks for the section first', () => {
  it('a Projects item has no Project field and no reorder level, and is added with no project', async () => {
    form();
    fireEvent.click(screen.getByRole('radio', { name: /Projects/ }));
    expect(screen.queryByLabelText('Reorder level')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Project(?!s)/)).not.toBeInTheDocument();
    fill(/^SKU/, 'PLATE-10MM');
    fill(/^Item name/, 'Plate');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ category: 'PROJECT_MATERIAL' });
    expect(body).not.toHaveProperty('projectNumber');
    expect(body).not.toHaveProperty('requiredStock');
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/projects/));
  });

  it('a Stores item has a category (not Project Material) and a reorder level', async () => {
    form();
    expect(screen.queryByRole('option', { name: 'Project Material' })).not.toBeInTheDocument();
    fill(/^SKU/, 'CON-9');
    fill(/^Item name/, 'Glue');
    fill('Reorder level', '12');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ category: 'CONSUMABLES', requiredStock: 12 });
    expect(body).not.toHaveProperty('projectNumber');
  });

  it('on edit, neither asks for a project nor changes the one an older item was tagged with', async () => {
    for (const initial of [projectItem('OLD-PLATE', null), projectItem('1369-PIPE', '1369')]) {
      mockPatch.mockClear();
      const { unmount } = form({ initial });
      expect(screen.getByRole('radio', { name: /Projects/ })).toBeDisabled();
      expect(screen.queryByLabelText(/^Project(?!s)/)).not.toBeInTheDocument();
      fill(/^Item name/, 'Renamed');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mockPatch).toHaveBeenCalled());
      expect(mockPatch.mock.calls[0]![1]).toMatchObject({ name: 'Renamed' });
      expect(mockPatch.mock.calls[0]![1]).not.toHaveProperty('projectNumber');
      expect(mockPatch.mock.calls[0]![1]).not.toHaveProperty('requiredStock');
      unmount();
    }
  });
});

const detail = (id: string) => render(
  <MemoryRouter initialEntries={[`/materials/${id}`]}>
    <ToastProvider><Routes><Route path="/materials/:id" element={<MaterialDetail />} /></Routes></ToastProvider>
  </MemoryRouter>,
);

describe('an item’s page says where it belongs', () => {
  it('a Projects item says only that it is Projects material, with no project or reorder level', async () => {
    detail('m-1369-PIPE');
    expect(await screen.findByText('1369-PIPE · Projects')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '1369 · Plant upgrade' })).not.toBeInTheDocument();
    expect(screen.queryByText('Reorder at')).not.toBeInTheDocument();
    // Project material goes to site, never into the store (Qodo, PR #125).
    expect(screen.queryByRole('link', { name: 'Receive' })).not.toBeInTheDocument();
  });

  it('a Stores item offers Receive', async () => {
    detail('m-DISC');
    expect(await screen.findByRole('link', { name: 'Receive' })).toHaveAttribute('href', '/stock/receive?materialId=m-DISC');
  });

  it('a Projects item with no project is not flagged for one', async () => {
    detail('m-OLD-PLATE');
    await screen.findByText('OLD-PLATE · Projects');
    expect(screen.queryByText(/No project yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose one' })).not.toBeInTheDocument();
  });

  it('a Stores item shows its section, category and reorder level', async () => {
    detail('m-DISC');
    expect(await screen.findByText('DISC · Stores · Consumables')).toBeInTheDocument();
    expect(screen.getByText('Reorder at')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stock summary' })).toBeInTheDocument();
  });
});

// Project material goes from the supplier straight to site: it has no stock
// status, and shows stock only while some is left from before, naming the
// project those leftovers were received for.
describe('a Projects item has no stock status, and names the project only for its leftovers', () => {
  const withStock = (sku: string, status: string, rows: unknown[]) => {
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (path: string) => {
      if (path === `/materials/m-${sku}`) return { ...ITEMS.find((m) => m.sku === sku), project: { projectNumber: sku.slice(0, 4), name: 'Plant upgrade', status } };
      if (path.startsWith('/reports/current-stock')) return rows;
      return base(path);
    });
  };
  const left = { materialId: 'm-1369-PIPE', locationId: 'l-1', locationName: 'Main store', locationType: 'STOREROOM', quantity: '3', requiredStock: '0', stockStatus: 'NOT_SET', percentOfRequired: null };

  it('says how it is ordered, with no stock summary, stock table or View in stock', async () => {
    withStock('1369-PIPE', 'ACTIVE', []);
    detail('m-1369-PIPE');
    const card = (await screen.findByRole('heading', { name: 'Ordering' })).closest('section')!;
    expect(within(card).getByText(/its purchase order, which says which project it is for/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Project status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Stock summary' })).not.toBeInTheDocument();
    expect(screen.queryByText('Stock by location')).not.toBeInTheDocument();
    expect(screen.queryByText('Left in the store')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View in stock' })).not.toBeInTheDocument();
  });

  it('shows what is left in the store from before, for the project it was received for', async () => {
    withStock('1369-PIPE', 'ACTIVE', [left]);
    detail('m-1369-PIPE');
    const table = await screen.findByRole('table', { name: 'Left in the store' });
    expect(within(table).getByText('Main store')).toBeInTheDocument();
    expect(within(table).queryByText('Reorder')).not.toBeInTheDocument();
    expect(within(table).queryByText('Item status')).not.toBeInTheDocument();
    expect(screen.getByText(/for project 1369 · Plant upgrade \(Active\). It is issued to that project/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Move to Stores' })).not.toBeInTheDocument();
    // The card doesn't say none is held while some is shown (Qodo, PR #126).
    expect(within(screen.getByRole('heading', { name: 'Ordering' }).closest('section')!).getByText(/What is shown as left in the store was received before/)).toBeInTheDocument();
  });

  it('sends what is left of an item with no project to be moved to Stores, not issued', async () => {
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/reports/current-stock') ? [{ ...left, materialId: 'm-OLD-PLATE' }] : base(path)));
    detail('m-OLD-PLATE');
    expect(await screen.findByText(/It has no project, so it isn.t issued: move it to Stores/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Move to Stores' })).toHaveAttribute('href', '/materials/no-project/leftovers');
    expect(screen.queryByText(/It is issued to its project/)).not.toBeInTheDocument();
  });

  it('sends a closed project’s leftovers to be moved to Stores', async () => {
    withStock('1369-PIPE', 'COMPLETED', [left]);
    detail('m-1369-PIPE');
    expect(await screen.findByText(/for project 1369 · Plant upgrade \(Completed\). The project is closed: move it to Stores/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Move to Stores' })).toHaveAttribute('href', '/projects/1369/leftovers');
  });
});

// Project on the Order Roadmap, Phase 2: ordered for a project chosen on the order, but not issued.
describe('a Projects item with no project', () => {
  it('offers Order, but no Issue, on its page', async () => {
    detail('m-OLD-PLATE');
    await screen.findByText('OLD-PLATE · Projects');
    expect(screen.getByRole('link', { name: 'Order' })).toHaveAttribute('href', '/purchase-orders/new?materialIds=m-OLD-PLATE');
    expect(screen.queryByRole('link', { name: 'Issue' })).not.toBeInTheDocument();
  });
});
