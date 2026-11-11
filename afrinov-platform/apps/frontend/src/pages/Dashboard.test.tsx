import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));
// Signed in as a store controller unless a test says otherwise; procurement on.
const auth = vi.hoisted(() => ({ roles: ['STORE_CONTROLLER'] as string[] }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

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

  // The project steps notice is off for now (Project Tracking Roadmap, Later): no notice, and no request for the steps.
  it('shows no project steps notice and does not ask for them', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Stock value');
    expect(screen.queryByText('Your project steps')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/my-project-steps');
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

  it('counts the slips nobody confirmed when receipt confirmation is Required, and links to them (ADR-034)', async () => {
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/settings/values')) return { 'inventory.receiptConfirmation': 'require' };
      if (path === '/slips/unconfirmed/summary') return { since: '2026-10-11T08:00:00.000Z', days: 30, issues: 3, loans: 1, oldestAt: '2026-10-20T08:00:00.000Z', disputed: 1, oldestDisputedAt: '2026-08-02T08:00:00.000Z' };
      return base(path);
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = (await screen.findByText('Slips not confirmed')).closest('a')!;
    expect(card).toHaveAttribute('href', '/movements?report=issued&view=cards&from=2026-10-11&receipt=unconfirmed');
    expect(card).toHaveTextContent('4');
    expect(card).toHaveTextContent('3 issues, 1 tool loan · last 30 days');
  });

  it('shows disputed slips of any age to the store controller on Ask too, and only the not-confirmed count on Required (E2)', async () => {
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/settings/values')) return { 'inventory.receiptConfirmation': 'ask' };
      if (path === '/slips/unconfirmed/summary') return { since: '2026-10-11T08:00:00.000Z', days: 30, issues: 3, loans: 0, oldestAt: null, disputed: 2, oldestDisputedAt: '2026-08-02T08:00:00.000Z' };
      return base(path);
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = (await screen.findByText('Disputed slips')).closest('a')!;
    expect(card).toHaveAttribute('href', '/movements?report=issued&view=cards&from=2026-08-02&receipt=disputed');
    expect(card).toHaveTextContent('2');
    expect(screen.queryByText('Slips not confirmed')).not.toBeInTheDocument();
  });

  it('asks nothing about receipts of someone who can’t correct a slip, while the setting is only Ask', async () => {
    auth.roles = ['TECHNICIAN'];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Tools checked out');
    expect(screen.queryByText('Slips not confirmed')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/slips/unconfirmed/summary');
    auth.roles = ['STORE_CONTROLLER'];
  });

  it('counts the tools out on loan, and links to the overdue ones', async () => {
    const loan = (out: string, overdue: boolean) => ({ loanId: out, out, overdue, daysOut: overdue ? 12 : 2, state: overdue ? 'OVERDUE' : 'ON_LOAN' });
    tools = [{ materialId: 'm-1', loans: [loan('2', false), loan('1', true)] }, { materialId: 'm-2', loans: [] }];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = (await screen.findByText('Tools checked out')).closest('a')!;
    expect(card).toHaveAttribute('href', '/tools?view=overdue');
    expect(card).toHaveTextContent('3');
    expect(card).toHaveTextContent('1 overdue');
  });

  it('says how many overdue tools need a decision, and links to them', async () => {
    tools = [{ materialId: 'm-1', loans: [
      { loanId: 'a', out: '1', overdue: true, state: 'OVERDUE' },
      { loanId: 'b', out: '2', overdue: true, state: 'NEEDS_DECISION' },
    ] }];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = (await screen.findByText('Tools checked out')).closest('a')!;
    expect(card).toHaveAttribute('href', '/tools?view=decide');
    expect(card).toHaveTextContent('3 overdue, 2 need a decision');
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
    expect(screen.getByRole('img', { name: 'Urgent: 2, Warning: 1, In range: 9, No required stock: 2' })).toBeInTheDocument();
    expect(screen.getByText('On hand × unit cost · excluding VAT')).toBeInTheDocument();
  });
});

describe('Dashboard: Stores counts against the Stores total', () => {
  it('shows items in stock and the health bar out of Stores items, as the status counts are', async () => {
    auth.roles = ['STORE_CONTROLLER'];
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/reports/stock-value') {
        return {
          ...VALUE,
          total: { ...VALUE.total, items: 50, itemsInStock: 40 },
          sections: { STORES: { items: 20, itemsInStock: 15, value: 0, unpriced: 0 }, PROJECTS: { items: 30, itemsInStock: 25, value: 0, unpriced: 0 } },
          projects: [],
        };
      }
      return path.startsWith('/reports/inventory') ? { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} } : [];
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('15 of 20')).toBeInTheDocument();
    expect(screen.getByText('active Stores items')).toBeInTheDocument();
    // Project material in the store is held for projects or left from before (Qodo, PR #143).
    expect(screen.getByText(/Project material in the store, held for projects or left from before:/)).toBeInTheDocument();
    expect(screen.queryByText(/went straight to site/)).not.toBeInTheDocument();
  });
});

describe('Dashboard: pending approvals card', () => {
  const order = (id: string, number: string, net: string) => ({
    id, number, createdAt: '2026-10-01T08:00:00Z', currency: 'ZAR', supplier: { name: 'Hydac' }, projectNumber: 'AFRI-1402' as string | null,
    totals: { subtotal: net, vat: '0.00', net, unpricedLines: 0 },
  });
  beforeEach(() => {
    auth.roles = ['DIRECTOR'];
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?awaitingMyApproval=true') return [order('po-1', 'AFRI-0101', '920.00')];
      if (path === '/purchase-orders?status=PENDING_APPROVAL') return [order('po-1', 'AFRI-0101', '920.00'), order('po-2', 'AFRI-0102', '9000.00'), order('po-3', 'AFRI-0103', '1.00')];
      if (path === '/reports/stock-value') return VALUE;
      if (path === '/tools') return [];
      return path.startsWith('/reports/inventory') ? { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} } : [];
    });
  });

  const approvalCard = async () => (await screen.findByText('Pending Approvals')).closest('a')!;

  it('shows a card with the orders waiting on this person, and counts the others', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = await approvalCard();
    expect(card).toHaveAttribute('href', '/purchase-orders?status=mine');
    expect(await within(card).findByText('1')).toBeInTheDocument();
    expect(await within(card).findByText('waiting for you · 2 more waiting on prices or someone else')).toBeInTheDocument();
  });

  it('says when nothing is waiting', async () => {
    mockGet.mockImplementation(async (path: string) => (path === '/reports/stock-value' ? VALUE : path.startsWith('/reports/inventory') ? { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} } : []));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = await approvalCard();
    expect(await within(card).findByText('nothing waiting for you')).toBeInTheDocument();
    expect(within(card).getByText('0')).toBeInTheDocument();
  });

  it('is not shown to those who do not approve', async () => {
    auth.roles = ['TECHNICIAN'];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Stock value by category');
    expect(screen.queryByText('Pending Approvals')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/purchase-orders?awaitingMyApproval=true');
  });

  it('is not shown to the store, who raises its orders and does not sign them', async () => {
    auth.roles = ['STORE_CONTROLLER'];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Stock value by category');
    expect(screen.queryByText('Pending Approvals')).not.toBeInTheDocument();
  });

  // Those who sign both kinds open the side with orders waiting.
  it("opens Order stock when only stock orders are waiting on someone who signs both", async () => {
    auth.roles = ['WORKSHOP_MANAGER'];
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?awaitingMyApproval=true') return [{ ...order('po-7', 'AFRI-0107', '400.00'), projectNumber: null }];
      if (path === '/reports/stock-value') return VALUE;
      return path.startsWith('/reports/inventory') ? { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} } : [];
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = await approvalCard();
    expect(card).toHaveAttribute('href', '/stock/orders?status=mine');
    expect(await within(card).findByText('1')).toBeInTheDocument();
  });

  it('counts only project orders as the others for someone who signs only those', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?awaitingMyApproval=true') return [order('po-1', 'AFRI-0101', '920.00')];
      if (path === '/purchase-orders?status=PENDING_APPROVAL') {
        return [
          order('po-1', 'AFRI-0101', '920.00'),
          { ...order('po-7', 'AFRI-0107', '400.00'), projectNumber: null },
          { ...order('po-8', 'AFRI-0108', '400.00'), projectNumber: null },
        ];
      }
      if (path === '/reports/stock-value') return VALUE;
      return path.startsWith('/reports/inventory') ? { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} } : [];
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = await approvalCard();
    expect(await within(card).findByText('waiting for your approval')).toBeInTheDocument();
    expect(within(card).queryByText(/more waiting/)).not.toBeInTheDocument();
  });

  // Qodo, PR #120: the Dashboard tells the kinds apart as the server does, by a null project.
  it('counts an order with an empty project number as a project order, as the server does', async () => {
    auth.roles = ['ADMIN'];
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?awaitingMyApproval=true') return [{ ...order('po-8', 'AFRI-0108', '500.00'), projectNumber: '' }];
      if (path === '/reports/stock-value') return VALUE;
      return path.startsWith('/reports/inventory') ? { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} } : [];
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await approvalCard()).toHaveAttribute('href', '/purchase-orders?status=mine');
  });

  it('counts both kinds for someone who approves both, and opens the side with project orders waiting', async () => {
    auth.roles = ['ADMIN'];
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders?awaitingMyApproval=true') {
        return [{ ...order('po-1', 'AFRI-0101', '920.00'), projectNumber: 'AFRI-1402' }, { ...order('po-7', 'AFRI-0107', '400.00'), projectNumber: null }];
      }
      if (path === '/reports/stock-value') return VALUE;
      return path.startsWith('/reports/inventory') ? { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} } : [];
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const card = await approvalCard();
    expect(card).toHaveAttribute('href', '/purchase-orders?status=mine');
    expect(await within(card).findByText('waiting for your approval (1 purchase, 1 stock)')).toBeInTheDocument();
  });
});
