import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({ useCanManageMaterials: () => false }));
vi.mock('../components/RoleGuard', () => ({ RoleGuard: () => null }));

const { Materials } = await import('./Materials');
const { ToastProvider } = await import('../components/Toast');
const item = (sku: string, over: Record<string, unknown> = {}) => ({
  id: `m-${sku}`, sku, name: `Item ${sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each',
  requiredStock: '10', unitCost: '5.0000', active: true, serialNumber: null, ...over,
});

const ITEMS = [
  item('PRICED'),
  item('NOPRICE', { unitCost: null }),
  item('NOREQ', { requiredStock: '0' }),
  item('OLD', { active: false, unitCost: null }),
];

function Where() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

function renderAt(url: string) {
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><Materials /><Where /></ToastProvider></MemoryRouter>);
}

describe('Materials page', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(ITEMS);
  });

  it('lists every item by default, with its unit cost', async () => {
    renderAt('/materials');
    expect(await screen.findByText('Item PRICED')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(ITEMS.length + 1);
    // PRICED and NOREQ cost R 5; the two without a price show a dash.
    expect(screen.getAllByText(/^R\s*5[,.]00$/)).toHaveLength(2);
    expect(screen.getAllByTitle('No unit price')).toHaveLength(2);
  });

  it('opens on the active items without a price when linked with ?view=no-price', async () => {
    renderAt('/materials?view=no-price');
    expect(await screen.findByText('Item NOPRICE')).toBeInTheDocument();
    expect(screen.queryByText('Item PRICED')).not.toBeInTheDocument();
    expect(screen.queryByText('Item OLD')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show')).toHaveValue('no-price');
  });

  it('shows the items without a Required Stock, and keeps the choice in the address', async () => {
    renderAt('/materials');
    await screen.findByText('Item PRICED');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'no-required' } });
    expect(screen.getByText('Item NOREQ')).toBeInTheDocument();
    expect(screen.queryByText('Item PRICED')).not.toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('?view=no-required');
  });

  it('shows inactive items on their own', async () => {
    renderAt('/materials?view=inactive');
    expect(await screen.findByText('Item OLD')).toBeInTheDocument();
    expect(screen.queryByText('Item NOPRICE')).not.toBeInTheDocument();
  });
});
