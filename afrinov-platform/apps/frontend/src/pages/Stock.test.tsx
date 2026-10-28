import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
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
