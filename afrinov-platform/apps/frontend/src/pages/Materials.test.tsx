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

const STOCK_PATH = '/reports/stock-status?section=ALL&includeInactive=true';
const SUMMARY = {
  items: 4, active: 3, inactive: 1, tabs: { STORES: 4, TOOLS: 0, PROJECTS: 0 },
  stock: { lines: 5, items: 3, tools: 0 }, notOnStock: { items: 1, tools: 0 },
  states: { IN_STOCK: 3, HELD_FOR_PROJECT: 0, OUT_OF_STOCK: 0, NEVER_RECEIVED: 1 }, toolsListed: 0,
};

function Where() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

function renderAt(url: string) {
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><Materials /><Where /></ToastProvider></MemoryRouter>);
}

describe('Materials page', () => {
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/materials/summary') return SUMMARY;
      return path === STOCK_PATH ? [] : ITEMS;
    });
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

  // On hand beside Required Stock, coloured as Stock status grades it.
  describe('On hand', () => {
    const status = (sku: string, onHand: string, over: Record<string, unknown> = {}) => ({
      materialId: `m-${sku}`, sku, onHand, onLoan: '0', status: 'OK', percentOfRequired: 100, locations: [], ...over,
    });
    const withStock = (rows: unknown[] | Error) => mockGet.mockImplementation(async (path: string) => {
      if (path === STOCK_PATH) { if (rows instanceof Error) throw rows; return rows; }
      return path === '/materials/summary' ? SUMMARY : ITEMS;
    });
    const onHandOf = (sku: string) => {
      const row = screen.getByText(`Item ${sku}`).closest('tr')!;
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
      return row.querySelectorAll('td')[headers.indexOf('On hand')]!;
    };

    it('shows each Stores item\'s stock on hand next to its required stock, under the same name as the Stock page', async () => {
      withStock([
        status('PRICED', '25'),
        status('NOPRICE', '1', { status: 'URGENT', percentOfRequired: 10 }),
        status('NOREQ', '4', { status: 'NOT_SET', percentOfRequired: null, onLoan: '2' }),
        status('OLD', '7'),
      ]);
      renderAt('/materials');
      await screen.findByText('Item PRICED');
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
      expect(headers.indexOf('On hand')).toBe(headers.indexOf('Required') - 1);
      expect(headers).not.toContain('Reorder');
      expect(mockGet).toHaveBeenCalledWith(STOCK_PATH);

      expect(onHandOf('PRICED')).toHaveTextContent('25');
      expect(onHandOf('NOPRICE')).toHaveTextContent('1');
      expect(onHandOf('NOPRICE').querySelector('[title]')).toHaveAttribute('title', 'Urgent: 10% of required stock');
      expect(onHandOf('NOPRICE').querySelector('.text-danger-600')).not.toBeNull();
      // A tool on loan is still owned: shown with what is on the shelf.
      expect(onHandOf('NOREQ')).toHaveTextContent('+2 checked out');
      // Inactive, but it still holds stock, and Stock lists that stock too.
      expect(onHandOf('OLD')).toHaveTextContent('7');
      expect(onHandOf('OLD').querySelector('[title="Inactive item"]')).not.toBeNull();
    });

    it('shows a dash when stock can\'t be loaded, and the catalogue still lists', async () => {
      withStock(Object.assign(new Error('down'), { code: 'SERVICE_UNAVAILABLE' }));
      renderAt('/materials');
      expect(await screen.findByText('Item PRICED')).toBeInTheDocument();
      expect(onHandOf('PRICED')).toHaveTextContent('—');
      expect(await screen.findByText('Stock figures could not be loaded')).toBeInTheDocument();
    });

    it('offers no warning to someone who may not see stock: the dash is all there is', async () => {
      withStock(Object.assign(new Error('no'), { code: 'FORBIDDEN' }));
      renderAt('/materials');
      expect(await screen.findByText('Item PRICED')).toBeInTheDocument();
      expect(screen.queryByText('Stock figures could not be loaded')).not.toBeInTheDocument();
    });

    it('isn\'t on the Projects tab: Projects material isn\'t held in the store', async () => {
      renderAt('/materials?section=PROJECTS');
      await screen.findByRole('tab', { name: /Projects/, selected: true });
      expect(screen.queryByRole('columnheader', { name: 'On hand' })).not.toBeInTheDocument();
      expect(mockGet).not.toHaveBeenCalledWith(STOCK_PATH);
    });
  });
});
