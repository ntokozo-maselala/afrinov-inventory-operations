// The Materials screens in two sections (materials sections roadmap, Phase 2):
// Stores and Projects tabs, the item form asking the section first, and an
// item's page saying where it belongs.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Material } from '../api/types';

const { mockGet, mockPost, mockPatch, perms } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(), perms: { manage: true } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({
  useCanManageMaterials: () => perms.manage,
  useHasRole: () => perms.manage,
  usePermissions: () => ({ hasPermission: () => perms.manage }),
}));
vi.mock('../components/RoleGuard', () => ({ RoleGuard: ({ children }: { children: React.ReactNode }) => perms.manage ? <>{children}</> : null }));

const { Materials } = await import('./Materials');
const { MaterialDetail } = await import('./MaterialDetail');
const { MaterialForm } = await import('../components/MaterialForm');
const { ToastProvider } = await import('../components/Toast');

const item = (sku: string, over: Partial<Material> = {}): Material => ({
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
  perms.manage = true;
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

function Where() {
  return <output data-testid="search">{useLocation().search}</output>;
}

const list = (url = '/materials') => render(
  <MemoryRouter initialEntries={[url]}><ToastProvider><Routes><Route path="/materials" element={<Materials />} /></Routes><Where /></ToastProvider></MemoryRouter>,
);
const skus = () => screen.queryAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/materials/m-')).map((a) => a.textContent);
const params = () => new URLSearchParams(screen.getByTestId('search').textContent ?? '');

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
    expect(within(screen.getByText('OLD-PLATE').closest('tr')!).getByText('No project yet')).toBeInTheDocument();
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

describe('Materials section filter regressions', () => {
  it.each(['/materials?section=invalid&project=1402', '/materials?project=none'])('defaults to Stores and ignores project filters at %s', async (url) => {
    list(url);
    await screen.findByText('DISC');
    expect(skus()).toEqual(['DISC', 'DRILL']);
    expect(screen.getByRole('tab', { name: /Stores/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument();
  });

  it('clears a Stores-only view and stale project when switching to Projects, preserving unrelated parameters', async () => {
    list('/materials?view=no-required&project=1369&keep=value');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Stores/ })).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect(skus()).toEqual(['1369-PIPE', '1402-BOLT', 'OLD-PLATE']);
    expect(Object.fromEntries(params())).toEqual({ section: 'PROJECTS', keep: 'value' });
    expect(screen.getByLabelText('Show')).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'No Required Stock' })).not.toBeInTheDocument();
  });

  it('keeps shared views across tabs, removing the section and project parameters when returning to Stores', async () => {
    list('/materials?section=PROJECTS&project=1369&view=active&keep=value');
    await screen.findByText('1369-PIPE');
    fireEvent.click(screen.getByRole('tab', { name: /Stores/ }));
    expect(skus()).toEqual(['DISC', 'DRILL']);
    expect(Object.fromEntries(params())).toEqual({ view: 'active', keep: 'value' });
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect(screen.getByLabelText('Show')).toHaveValue('active');
    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(skus()).toHaveLength(3);
  });

  it.each(['no-required', 'unknown'])('ignores unsupported Projects view %s', async (view) => {
    list(`/materials?section=PROJECTS&view=${view}`);
    await screen.findByText('1369-PIPE');
    expect(screen.getByLabelText('Show')).toHaveValue('');
    expect(skus()).toHaveLength(3);
  });

  it('updates project and view filters in the URL without losing the other parameters', async () => {
    list('/materials?section=PROJECTS&keep=value');
    await screen.findByText('1369-PIPE');
    fill('Project', '1402');
    expect(skus()).toEqual(['1402-BOLT']);
    expect(Object.fromEntries(params())).toEqual({ section: 'PROJECTS', project: '1402', keep: 'value' });
    fill('Show', 'active');
    expect(params().get('project')).toBe('1402');
    expect(params().get('view')).toBe('active');
    fill('Project', '');
    expect(params().has('project')).toBe(false);
    expect(params().get('view')).toBe('active');
    expect(skus()).toHaveLength(3);
    fill('Show', '');
    expect(Object.fromEntries(params())).toEqual({ section: 'PROJECTS', keep: 'value' });
  });

  it('clears filters while retaining the Projects tab and unrelated URL parameters', async () => {
    list('/materials?section=PROJECTS&project=1369&view=active&keep=value');
    await screen.findByText('1369-PIPE');
    fill('Search', 'pipe');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(screen.getByLabelText('Show')).toHaveValue('');
    expect(skus()).toHaveLength(3);
    expect(Object.fromEntries(params())).toEqual({ section: 'PROJECTS', keep: 'value' });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('ignores a Stores category filter in Projects and restores it when returning to Stores', async () => {
    list();
    await screen.findByText('DISC');
    fill('Category', 'TOOLS');
    expect(skus()).toEqual(['DRILL']);
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect(skus()).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: /Stores/ }));
    expect(screen.getByLabelText('Category')).toHaveValue('TOOLS');
    expect(skus()).toEqual(['DRILL']);
  });

  it('sorts shuffled rows by project then item name, with unassigned items last, and deduplicates project options', async () => {
    mockGet.mockResolvedValueOnce([
      { ...projectItem('Z-UNASSIGNED', null), name: 'Aluminium plate' },
      { ...projectItem('Z-PIPE', '1402', 'Silo'), name: 'Aluminium pipe' },
      { ...projectItem('Z-BOLT', '1369'), name: 'Aluminium bolt' },
      { ...projectItem('A-PIPE', '1402', 'Silo'), name: 'Zinc pipe' },
      { ...projectItem('A-UNASSIGNED', null), name: 'Zinc plate' },
      { ...projectItem('A-BOLT', '1369'), name: 'Zinc bolt' },
      item('STORE'),
    ]);
    list('/materials?section=PROJECTS');
    await screen.findByText('A-BOLT');
    expect(skus()).toEqual(['Z-BOLT', 'A-BOLT', 'Z-PIPE', 'A-PIPE', 'Z-UNASSIGNED', 'A-UNASSIGNED']);
    expect(within(screen.getByLabelText('Project')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All projects', '1369 · Plant upgrade', '1402 · Silo', 'No project yet (2)',
    ]);
    expect(screen.getByText('6 of 6')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Stores/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Projects/ })).toHaveTextContent('6');
    fill('Project', 'none');
    expect(skus()).toEqual(['Z-UNASSIGNED', 'A-UNASSIGNED']);
  });

  it.each(['  pLaNt UpGrAdE  ', '1369'])('searches project names and numbers using %j', async (query) => {
    mockGet.mockResolvedValueOnce([
      projectItem('PIPE', '1369'), projectItem('BOLT', '1402', 'Silo'), projectItem('UNASSIGNED', null),
    ]);
    list('/materials?section=PROJECTS');
    await screen.findByText('PIPE');
    fill('Search', query);
    expect(skus()).toEqual(['PIPE']);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Projects/ })).toHaveTextContent('3');
  });

  it('combines project, view and search filters without including inactive or other-project items', async () => {
    mockGet.mockResolvedValueOnce([
      { ...projectItem('PIPE-UNPRICED', '1369'), unitCost: null },
      { ...projectItem('PIPE-OLD', '1369'), active: false, unitCost: null },
      { ...projectItem('PIPE-FREE', '1369'), unitCost: '0' },
      { ...projectItem('BOLT-UNPRICED', '1369'), unitCost: null },
      { ...projectItem('PIPE-OTHER', '1402'), unitCost: null },
    ]);
    list('/materials?section=PROJECTS&project=1369&view=no-price');
    await screen.findByText('PIPE-UNPRICED');
    fill('Search', 'pipe');
    expect(skus()).toEqual(['PIPE-UNPRICED']);
    expect(screen.getByText('1 of 5')).toBeInTheDocument();
  });

  it('retains a linked project with no materials in the filter and offers clearing the filter', async () => {
    list('/materials?section=PROJECTS&project=9999');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Projects/ })).toHaveTextContent('3'));
    expect(screen.getByLabelText('Project')).toHaveValue('9999');
    expect(screen.getByRole('option', { name: '9999' })).toBeInTheDocument();
    expect(screen.getByText('No materials match')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add your first item' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(skus()).toHaveLength(3);
  });

  it.each(['/materials?section=PROJECTS', '/materials?section=PROJECTS&project=none'])('adds from %s without treating the filter sentinel as a project number', async (url) => {
    list(url);
    await screen.findByText('OLD-PLATE');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const drawer = within(screen.getByRole('dialog'));
    await drawer.findByRole('option', { name: '1369 · Plant upgrade' });
    expect(drawer.getByLabelText(/^Project\b/)).toHaveValue('');
    expect(drawer.getByRole('radio', { name: /Projects/ })).toBeChecked();
    fireEvent.change(drawer.getByLabelText(/^SKU/), { target: { value: 'NEW' } });
    fireEvent.change(drawer.getByLabelText(/^Item name/), { target: { value: 'New item' } });
    fireEvent.click(drawer.getByRole('button', { name: 'Add item' }));
    expect(drawer.getByText('Choose the project this material is for.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([
    ['/materials', 'No Stores materials yet', /Stores/],
    ['/materials?section=PROJECTS', 'No Projects materials yet', /Projects/],
  ])('starts the first item in the empty section at %s', async (url, title, section) => {
    mockGet.mockResolvedValueOnce([]);
    list(url);
    fireEvent.click(await screen.findByRole('button', { name: 'Add your first item' }));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('radio', { name: section })).toBeChecked();
  });

  it('does not offer to add an item in an empty Projects section without management permission', async () => {
    perms.manage = false;
    mockGet.mockResolvedValueOnce([]);
    list('/materials?section=PROJECTS');
    expect(await screen.findByText('No Projects materials yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add your first item' })).not.toBeInTheDocument();
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

  it.each([null, { projectNumber: '1369', name: null }])('shows an assigned project without a missing name suffix (%j)', async (project) => {
    mockGet.mockResolvedValueOnce({ ...projectItem('PIPE', '1369'), project });
    detail('m-PIPE');
    expect(await screen.findByText('PIPE · Project 1369')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1369' })).toHaveAttribute('href', '/materials?section=PROJECTS&project=1369');
    expect(screen.queryByRole('button', { name: 'Choose one' })).not.toBeInTheDocument();
    expect(screen.queryByText('Reorder at')).not.toBeInTheDocument();
  });

  it('encodes project numbers in both catalogue and material-detail links', async () => {
    const special = projectItem('SPECIAL', 'A/B & 1', 'Special job');
    mockGet.mockResolvedValueOnce([special]);
    const { unmount } = list('/materials?section=PROJECTS');
    const href = '/materials?section=PROJECTS&project=A%2FB%20%26%201';
    expect(await screen.findByRole('link', { name: 'A/B & 1 · Special job' })).toHaveAttribute('href', href);
    unmount();
    mockGet.mockResolvedValueOnce(special);
    detail('m-SPECIAL');
    expect(await screen.findByRole('link', { name: 'A/B & 1 · Special job' })).toHaveAttribute('href', href);
  });

  it('opens project assignment from Choose one and saves only the editable fields', async () => {
    detail('m-OLD-PLATE');
    fireEvent.click(await screen.findByRole('button', { name: 'Choose one' }));
    const drawer = within(screen.getByRole('dialog'));
    await drawer.findByRole('option', { name: '1402 · Silo' });
    expect(drawer.getByRole('radio', { name: /Projects/ })).toBeDisabled();
    fireEvent.change(drawer.getByLabelText(/^Project\b/), { target: { value: '1402' } });
    fireEvent.click(drawer.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledExactlyOnceWith('/materials/m-OLD-PLATE', {
      name: 'Item OLD-PLATE', unitOfMeasure: 'each', unitCost: 5, description: null, projectNumber: '1402',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('OLD-PLATE saved')).toBeInTheDocument();
  });

  it('shows an unassigned project without offering assignment to a user who cannot manage materials', async () => {
    perms.manage = false;
    detail('m-OLD-PLATE');
    expect(await screen.findByText('OLD-PLATE · Projects · no project yet')).toBeInTheDocument();
    expect(screen.getByText('No project yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose one' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('keeps assigned project links available to users who cannot manage materials', async () => {
    perms.manage = false;
    detail('m-1369-PIPE');
    expect(await screen.findByRole('link', { name: '1369 · Plant upgrade' })).toHaveAttribute('href', '/materials?section=PROJECTS&project=1369');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('treats an unknown category as Stores and displays its original label and reorder level', async () => {
    mockGet.mockResolvedValueOnce(item('LEGACY', { category: 'LEGACY_CATEGORY' }));
    detail('m-LEGACY');
    expect(await screen.findByText('LEGACY · Stores · LEGACY_CATEGORY')).toBeInTheDocument();
    expect(screen.getByText('Reorder at')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose one' })).not.toBeInTheDocument();
  });
});
