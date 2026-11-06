import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, summary } = vi.hoisted(() => ({ mockGet: vi.fn(), summary: { states: { NEVER_RECEIVED: 0 } } }));
vi.mock('../api/client', () => ({
  api: { get: (path: string) => (path === '/materials/summary' ? Promise.resolve(summary) : mockGet(path)) },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../components/RoleGuard', () => ({ RoleGuard: () => null }));

// Signed in as a store controller, who may do everything on these pages; tests that need another role set signedIn.roles.
const { signedIn } = vi.hoisted(() => ({ signedIn: { roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: signedIn.roles } }) }));

const { Stock } = await import('./Stock');
const { ToastProvider } = await import('../components/Toast');

const row = (sku: string, name: string, category: string, quantity: string, stockStatus: string) => ({
  materialId: `m-${sku}`, materialSku: sku, materialName: name, category, locationId: 'l-1', locationName: 'A-1',
  unitOfMeasure: 'each', quantity, requiredStock: '10', stockStatus, percentOfRequired: null,
});

const ROWS = [
  row('DISC-115', 'Cutting disc', 'CONSUMABLES', '30', 'OK'),
  row('GLOVE-L', 'Welding gloves', 'TOOLING_PPE_ELECTRICAL', '2', 'URGENT'),
  row('BOLT-M16', 'M16 bolt', 'FASTENERS_SLUGS_INSULATION', '0', 'URGENT'),
];

function renderAt(url: string) {
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><Stock /></ToastProvider></MemoryRouter>);
}

describe('Stock page filters from the address', () => {
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => (path === '/locations' ? [] : ROWS));
  });

  it('labels the Stores threshold column as Required, not Reorder', async () => {
    renderAt('/stock');

    const table = await screen.findByRole('table', { name: 'Stock lines' });
    expect(within(table).getByRole('columnheader', { name: 'Required' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Reorder' })).not.toBeInTheDocument();
  });

  it('searches for ?q=, as an item page links with its SKU', async () => {
    renderAt('/stock?q=DISC-115');
    expect(await screen.findByText('Cutting disc')).toBeInTheDocument();
    expect(screen.queryByText('Welding gloves')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Search/)).toHaveValue('DISC-115');
  });

  it('applies ?status= and ?category=, and ignores values it does not know', async () => {
    renderAt('/stock?status=URGENT&category=TOOLING_PPE_ELECTRICAL');
    expect(await screen.findByText('Welding gloves')).toBeInTheDocument();
    expect(screen.queryByText('M16 bolt')).not.toBeInTheDocument();
    expect(screen.queryByText('Cutting disc')).not.toBeInTheDocument();
  });

  it('shows everything when the address has no usable filter', async () => {
    renderAt('/stock?status=nonsense');
    expect(await screen.findByText('M16 bolt')).toBeInTheDocument();
    expect(screen.getByText('Cutting disc')).toBeInTheDocument();
  });
});

// Qodo, PR #142: Transfer and Adjust move Stores stock, so stock held for a
// project is not listed with them.
describe('Stock page: Stores stock only', () => {
  it('leaves out stock held for a project, so its Transfer and Adjust never touch Stores stock', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => (path === '/locations' ? [] : [
      ...ROWS, { ...ROWS[0]!, quantity: '50', heldForProject: 'AFRI-1325' },
    ]));
    renderAt('/stock');
    const table = await screen.findByRole('table', { name: 'Stock lines' });
    const discs = within(table).getAllByText('Cutting disc');
    expect(discs).toHaveLength(1);
    expect(within(discs[0]!.closest('tr')!).getByText('30')).toBeInTheDocument();
    expect(screen.getByText(/^3 of 3 lines/)).toBeInTheDocument();
  });
});

describe('Stock page: by room', () => {
  const LOCATIONS = [
    { id: 'store', name: 'Main Storeroom', parentId: null, parent: null },
    { id: 'd1', name: 'D-1', parentId: 'store', parent: { name: 'Main Storeroom' } },
    { id: 'boiler', name: 'Boiler Shop', parentId: null, parent: null },
  ];
  const at = (sku: string, locationId: string, locationName: string) => ({ ...row(sku, `Item ${sku}`, 'CONSUMABLES', '5', 'OK'), materialId: `m-${sku}`, locationId, locationName });
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => (path === '/locations'
      ? LOCATIONS
      : [at('ON-RACK', 'd1', 'D-1'), at('IN-ROOM', 'store', 'Main Storeroom'), at('ELSEWHERE', 'boiler', 'Boiler Shop')]));
  });

  it('names a rack with its room, and filters to a room and the racks inside it', async () => {
    renderAt('/stock');
    expect(await screen.findByText('D-1 · Main Storeroom')).toBeInTheDocument();
    renderAt('/stock?room=store');
    const tables = await screen.findAllByRole('table');
    const last = tables.at(-1)!;
    expect(last.textContent).toContain('ON-RACK');
    expect(last.textContent).toContain('IN-ROOM');
    expect(last.textContent).not.toContain('ELSEWHERE');
  });
});

describe('Stock page: a room link while the locations are unavailable', () => {
  const at = (sku: string, locationId: string, locationName: string) => ({ ...row(sku, `Item ${sku}`, 'CONSUMABLES', '5', 'OK'), materialId: `m-${sku}`, locationId, locationName });
  const STOCK = [at('ON-RACK', 'd1', 'D-1'), at('ELSEWHERE', 'boiler', 'Boiler Shop')];

  it('says the rooms failed to load, with a retry, rather than show stock from everywhere', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/locations') throw new Error('Network down');
      return STOCK;
    });
    renderAt('/stock?room=store');
    expect(await screen.findByText(/Rooms could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText('ELSEWHERE')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });

  it('keeps a linked room that holds no racks in force, and shown so it can be cleared', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => (path === '/locations'
      ? [{ id: 'boiler', name: 'Boiler Shop', parentId: null, parent: null }, { id: 'd1', name: 'D-1', parentId: null, parent: null }]
      : STOCK));
    renderAt('/stock?room=boiler');
    expect(await screen.findByText('ELSEWHERE')).toBeInTheDocument();
    expect(screen.queryByText('ON-RACK')).toBeNull();
    expect((screen.getByLabelText('Room') as HTMLSelectElement).value).toBe('boiler');
  });
});

// Stock counts lines, an item at a location, so it says how many items that is
// and which it can't list (ADR-031).
describe('Stock page: lines and items', () => {
  const line = (over: Record<string, unknown>) => ({
    materialSku: 'DISC', materialName: 'Disc', category: 'CONSUMABLES', locationName: 'A-1', quantity: '5', unitOfMeasure: 'each',
    requiredStock: '10', stockStatus: 'OK', percentOfRequired: 50, heldForProject: null, ...over,
  });
  const rows = [
    line({ materialId: 'm-1', locationId: 'l-1' }),
    line({ materialId: 'm-1', locationId: 'l-2', locationName: 'A-2' }),
    line({ materialId: 't-1', locationId: 'l-1', materialSku: 'DRILL', materialName: 'Drill', category: 'TOOLS' }),
  ];
  const open = () => render(<MemoryRouter initialEntries={['/stock']}><ToastProvider><Stock /></ToastProvider></MemoryRouter>);

  beforeEach(() => {
    summary.states.NEVER_RECEIVED = 0;
    mockGet.mockReset().mockImplementation(async (path: string) => (path === '/locations' ? [] : rows));
  });

  it('counts an item in two locations once, and says how many tools are among the items', async () => {
    open();
    expect(await screen.findByText('3 of 3 lines · 2 items, 1 tool among them')).toBeInTheDocument();
  });

  it('links to the items it cannot list', async () => {
    summary.states.NEVER_RECEIVED = 3;
    open();
    expect(await screen.findByRole('link', { name: '3 items' })).toHaveAttribute('href', '/materials?stock=never');
    expect(screen.getByText(/never received, so not listed here/)).toBeInTheDocument();
  });

  it('says nothing when every item has been received', async () => {
    open();
    await screen.findByText('3 of 3 lines · 2 items, 1 tool among them');
    expect(screen.queryByText(/never received/)).not.toBeInTheDocument();
  });
});
