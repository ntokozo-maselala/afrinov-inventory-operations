import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));

const { Dashboard } = await import('./Dashboard');

const VALUE = {
  currency: 'ZAR',
  categories: [
    { category: 'CONSUMABLES', items: 12, itemsInStock: 10, value: 7500, unpriced: 1, share: 0.75 },
    { category: 'TOOLS', items: 2, itemsInStock: 0, value: 2500, unpriced: 0, share: 0.25 },
  ],
  total: { items: 14, itemsInStock: 10, value: 10000, unpriced: 1 },
  status: { URGENT: 2, WARNING: 1, OK: 9, NOT_SET: 2, outOfStock: 4 },
};

describe('Dashboard', () => {
  let tools: unknown[] = [];
  beforeEach(() => {
    tools = [];
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/reports/stock-value') return VALUE;
      if (path === '/reports/low-stock') return [];
      if (path === '/tools') return tools;
      return {
        generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {},
        byLocation: [
          { locationId: 'l-1', locationName: 'Central Store', locationType: 'STORE', quantity: 20, inventoryValue: 6000, share: 0.6 },
          { locationId: 'l-2', locationName: 'Workshop', locationType: 'STORE', quantity: 10, inventoryValue: 4000, share: 0.4 },
        ],
      };
    });
  });

  it('shows the stock value per category, with a total, and the status counts', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const table = within(await screen.findByLabelText('Stock value by category'));
    expect(await table.findByRole('img', { name: /Consumables .*75%/ })).toBeInTheDocument();
    expect(table.getByText('Unpriced: 1 in Consumables')).toBeInTheDocument();
    expect(table.getByText('All categories')).toBeInTheDocument();

    expect(screen.getByText('10 of 14')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Urgent/ })).toHaveAttribute('href', '/reports/stock-status?view=URGENT');
    expect(screen.getByRole('link', { name: /^Out of stock/ })).toHaveAttribute('href', '/reports/stock-status?view=out');
    expect(screen.queryByLabelText('Time range')).not.toBeInTheDocument();
  });

  it('opens the unpriced items from the stock value card, and links nowhere when all are priced', async () => {
    const { unmount } = render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect((await screen.findByText('Stock value')).closest('a')).toHaveAttribute('href', '/materials?view=no-price');
    unmount();

    mockGet.mockImplementation(async (path: string) => {
      if (path === '/reports/stock-value') return { ...VALUE, total: { ...VALUE.total, unpriced: 0 } };
      if (path === '/reports/low-stock' || path === '/tools') return [];
      return { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} };
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect((await screen.findByText('Stock value')).closest('a')).toBeNull();
  });

  it('counts the tools out on loan, and links to the overdue ones', async () => {
    const loan = (out: string, overdue: boolean) => ({ loanId: out, out, overdue, daysOut: overdue ? 12 : 2 });
    tools = [{ materialId: 'm-1', loans: [loan('2', false), loan('1', true)] }, { materialId: 'm-2', loans: [] }];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = (await screen.findByText('Tools out')).closest('a')!;
    expect(card).toHaveAttribute('href', '/tools?view=overdue');
    expect(card).toHaveTextContent('3');
    expect(card).toHaveTextContent('1 overdue');
  });
});

describe('Dashboard items table', () => {
  it('sends View all to Stock, and says when the table is cut short', async () => {
    const line = (n: number) => ({ materialId: `m-${n}`, locationId: 'l-1', sku: `SKU-${n}`, name: `Item ${n}`, category: 'CONSUMABLES', locationName: 'A-1', quantity: 1, inventoryValue: 1, status: 'IN_STOCK' });
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/reports/stock-value') return VALUE;
      if (path === '/reports/low-stock' || path === '/tools') return [];
      return { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [line(1), line(2)], inventoryTotal: 340, kpis: {} };
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText(/Showing 2 of 340 lines/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all on Stock' })).toHaveAttribute('href', '/stock');
    const section = within(screen.getByRole('region', { name: 'Inventory items' }));
    expect(section.getByRole('link', { name: 'View stock' })).toHaveAttribute('href', '/stock');
  });
});

describe('Dashboard analytics', () => {
  it('shows current category valuation and the backend stock-health bands', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/reports/stock-value') return VALUE;
      if (path === '/reports/low-stock' || path === '/tools') return [];
      return {
        generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {},
        byLocation: [
          { locationId: 'l-1', locationName: 'Central Store', locationType: 'STORE', quantity: 20, inventoryValue: 6000, share: 0.6 },
          { locationId: 'l-2', locationName: 'Workshop', locationType: 'STORE', quantity: 10, inventoryValue: 4000, share: 0.4 },
        ],
      };
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'Stock health' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Current stock value by category: Consumables .*75%/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Stock value by location' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Central Store 60%; Workshop 40%/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Urgent: 2, Warning: 1, In range: 9, No reorder level: 2' })).toBeInTheDocument();
    expect(screen.getByText('On hand × unit cost · excluding VAT')).toBeInTheDocument();
  });
});
