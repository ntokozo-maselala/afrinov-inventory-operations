// The Materials screens in two sections (materials sections roadmap, Phase 2):
// Stores and Projects tabs, the item form asking the section first, and an
// item's page saying where it belongs.
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

  it('shows Projects items grouped by project, with those without a project last', async () => {
    list();
    await screen.findByText('DISC');
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect(skus()).toEqual(['1369-PIPE', '1402-BOLT', 'OLD-PLATE']);
    expect(screen.getByRole('link', { name: '1369 · Plant upgrade' })).toHaveAttribute('href', '/materials?section=PROJECTS&project=1369');
    expect(within(within(screen.getByRole('table')).getByText('OLD-PLATE').closest('tr')!).getByText('No project yet')).toBeInTheDocument();
    expect(screen.queryByText('Reorder')).not.toBeInTheDocument();
  });

  it('opens on one project from the link, and on the items with no project', async () => {
    const { unmount } = list('/materials?section=PROJECTS&project=1402');
    await screen.findByText('1402-BOLT');
    expect(skus()).toEqual(['1402-BOLT']);
    unmount();
    list('/materials?section=PROJECTS&project=none');
    await screen.findByText('OLD-PLATE');
    expect(skus()).toEqual(['OLD-PLATE']);
  });

  it('adds an item from the Projects tab as Projects material on that project', async () => {
    list('/materials?section=PROJECTS&project=1369');
    await screen.findByText('1369-PIPE');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('radio', { name: /Projects/ })).toBeChecked();
    expect(await within(drawer).findByLabelText(/^Project(?!s)/)).toHaveValue('1369');
  });
});

const form = (props: Record<string, unknown> = {}) => render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} {...props} />);
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('the item form asks for the section first', () => {
  it('a Projects item takes an open project and no reorder level', async () => {
    form();
    fireEvent.click(screen.getByRole('radio', { name: /Projects/ }));
    expect(screen.queryByLabelText('Reorder level')).not.toBeInTheDocument();
    await screen.findByRole('option', { name: '1369 · Plant upgrade' });
    expect(screen.queryByRole('option', { name: /1200/ })).not.toBeInTheDocument();
    fill(/^SKU/, '1369-FLANGE');
    fill(/^Item name/, 'Flange');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText('Choose the project this material is for.')).toBeInTheDocument();
    fill(/^Project(?!s)/, '1369');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ category: 'PROJECT_MATERIAL', projectNumber: '1369' });
    expect(body).not.toHaveProperty('requiredStock');
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

  it('on edit, gives an item with no project its project; one with a project keeps it', async () => {
    const { unmount } = form({ initial: projectItem('OLD-PLATE', null) });
    expect(screen.getByRole('radio', { name: /Projects/ })).toBeDisabled();
    await screen.findByRole('option', { name: '1402 · Silo' });
    fill(/^Project(?!s)/, '1402');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    expect(mockPatch.mock.calls[0]![1]).toMatchObject({ projectNumber: '1402' });
    expect(mockPatch.mock.calls[0]![1]).not.toHaveProperty('requiredStock');
    unmount();

    mockPatch.mockClear();
    form({ initial: projectItem('1369-PIPE', '1369') });
    expect(screen.getByLabelText(/^Project(?!s)/)).toHaveValue('1369 · Plant upgrade');
    expect(screen.getByLabelText(/^Project(?!s)/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    expect(mockPatch.mock.calls[0]![1]).not.toHaveProperty('projectNumber');
  });
});

const detail = (id: string) => render(
  <MemoryRouter initialEntries={[`/materials/${id}`]}>
    <ToastProvider><Routes><Route path="/materials/:id" element={<MaterialDetail />} /></Routes></ToastProvider>
  </MemoryRouter>,
);

describe('an item’s page says where it belongs', () => {
  it('a Projects item links to its project’s materials, with no reorder level', async () => {
    detail('m-1369-PIPE');
    expect(await screen.findByRole('link', { name: '1369 · Plant upgrade' })).toHaveAttribute('href', '/materials?section=PROJECTS&project=1369');
    expect(screen.getByText('1369-PIPE · Project 1369 · Plant upgrade')).toBeInTheDocument();
    expect(screen.queryByText('Reorder at')).not.toBeInTheDocument();
  });

  it('a Projects item without a project says so', async () => {
    detail('m-OLD-PLATE');
    expect(await screen.findByText(/No project yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose one' })).toBeInTheDocument();
  });

  it('a Stores item shows its section, category and reorder level', async () => {
    detail('m-DISC');
    expect(await screen.findByText('DISC · Stores · Consumables')).toBeInTheDocument();
    expect(screen.getByText('Reorder at')).toBeInTheDocument();
  });
});

describe('Needs a project (Phase 3)', () => {
  it('tells the Stores tab how many Projects items need a project, linking to them', async () => {
    list();
    const notice = await screen.findByText('1 Projects item needs a project');
    expect(within(notice.closest('[role="status"]')!).getByRole('link', { name: 'Give them their projects' })).toHaveAttribute('href', '/materials?section=PROJECTS&project=none');
  });

  it('gives the ticked items the chosen project, and reloads', async () => {
    list('/materials?section=PROJECTS');
    const panel = (await screen.findByRole('heading', { name: /Needs a project/ })).closest('section')!;
    const give = within(panel).getByRole('button', { name: 'Tick the items first' });
    expect(give).toBeDisabled();
    fireEvent.click(within(panel).getByLabelText('Give OLD-PLATE a project'));
    await within(panel).findByRole('option', { name: '1369 · Plant upgrade' });
    expect(within(panel).queryByRole('option', { name: /1200/ })).not.toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText('Project'), { target: { value: '1369' } });
    const loads = mockGet.mock.calls.filter(([p]) => p === '/materials').length;
    fireEvent.click(within(panel).getByRole('button', { name: 'Give 1 item this project' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/materials/m-OLD-PLATE', { projectNumber: '1369' }));
    expect(await screen.findByText('1 item given project 1369')).toBeInTheDocument();
    await waitFor(() => expect(mockGet.mock.calls.filter(([p]) => p === '/materials').length).toBeGreaterThan(loads));
  });

  it('says which items kept no project when the server refuses', async () => {
    mockPatch.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Project 1369 is closed, so no new material can be added to it' });
    list('/materials?section=PROJECTS');
    const panel = (await screen.findByRole('heading', { name: /Needs a project/ })).closest('section')!;
    fireEvent.click(within(panel).getByLabelText('Tick all'));
    await within(panel).findByRole('option', { name: '1369 · Plant upgrade' });
    fireEvent.change(within(panel).getByLabelText('Project'), { target: { value: '1369' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Give 1 item this project' }));
    expect(await within(panel).findByText(/OLD-PLATE: Project 1369 is closed/)).toBeInTheDocument();
  });

  it('a Projects item with no project offers no Order or Issue on its page', async () => {
    detail('m-OLD-PLATE');
    await screen.findByText(/No project yet/);
    expect(screen.queryByRole('link', { name: 'Order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Issue' })).not.toBeInTheDocument();
  });
});
