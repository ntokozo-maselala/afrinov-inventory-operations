import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    mockGet.mockReset().mockResolvedValue(ROWS);
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
