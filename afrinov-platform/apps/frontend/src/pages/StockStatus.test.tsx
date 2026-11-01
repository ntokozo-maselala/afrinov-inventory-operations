import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockDownload, mockPdf, perms } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn(), mockPdf: vi.fn(), perms: { admin: false, receive: false } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({ useIsAdmin: () => perms.admin, useHasRole: () => perms.receive, usePermissions: () => ({ hasPermission: () => perms.receive }) }));
vi.mock('../api/exportReorderList', () => ({ downloadReorderList: mockDownload, downloadReorderListPdf: mockPdf }));
const features = vi.hoisted(() => ({ procurement: true }));
vi.mock('../config/features', () => ({ get PROCUREMENT_ENABLED() { return features.procurement; } }));
// Today, for what is overdue.
vi.mock('../lib/rfq', () => ({ todayInSouthAfrica: () => '2026-11-15' }));

const { StockStatus } = await import('./StockStatus');
const { ToastProvider } = await import('../components/Toast');

const row = (sku: string, name: string, status: string, onHand: string, required: string, percent: number | null, reorder: string, where = 'A-1') => ({
  materialId: `m-${sku}`, sku, name, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: required, onHand,
  percentOfRequired: percent, status, reorderQuantity: reorder, unitCost: '10',
  locations: Number(onHand) > 0 ? [{ locationId: 'l-1', locationName: where, quantity: onHand }] : [],
  lastSupplier: sku === 'DISC' ? { name: 'Hydroscand', receivedAt: '2026-09-18T00:00:00.000Z' } : null,
});

const ROWS = [
  row('DISC', 'Grinding disc', 'URGENT', '11', '100', 11, '89'),
  row('FLAP', 'Flap disc', 'WARNING', '10', '50', 20, '40', 'Stores'),
  row('CUT', 'Cutting disc', 'OK', '167', '100', 167, '0'),
  row('SLUG', 'Slugs 14mm', 'NOT_SET', '6', '0', null, '0'),
];

describe('StockStatus page', () => {
  beforeEach(() => {
    perms.admin = false;
    mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : ROWS));
    mockDownload.mockReset().mockResolvedValue(undefined);
    mockPdf.mockReset().mockResolvedValue(undefined);
  });

  /** Open the Download menu and choose a format. */
  function downloadAs(format: 'Excel (.xlsx)' | 'PDF (.pdf)') {
    fireEvent.click(screen.getByRole('button', { name: 'Download re-order list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: format }));
  }

  function renderPage() {
    render(<MemoryRouter><ToastProvider><StockStatus /></ToastProvider></MemoryRouter>);
  }

  it('opens on the items that need re-ordering, with the percentage and re-order quantity', async () => {
    renderPage();
    expect(await screen.findByText('Grinding disc')).toBeInTheDocument();
    expect(screen.getByText('Flap disc')).toBeInTheDocument();
    expect(screen.queryByText('Cutting disc')).not.toBeInTheDocument();
    const disc = screen.getByText('Grinding disc').closest('tr')!;
    expect(within(disc).getByText('11%')).toBeInTheDocument();
    expect(within(disc).getByText('89')).toBeInTheDocument();
    expect(within(disc).getByText('Urgent')).toBeInTheDocument();
    expect(within(disc).getByText('Hydroscand')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/reports/stock-status');
  });

  it('counts items by status, and shows a status when its count is clicked', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    const counts = screen.getByLabelText('Items by status');
    fireEvent.click(within(counts).getByText('Not set').closest('button')!);
    expect(screen.getByText('Slugs 14mm')).toBeInTheDocument();
    expect(screen.queryByText('Grinding disc')).not.toBeInTheDocument();
    expect(within(screen.getByText('Slugs 14mm').closest('tr')!).getByText('Not set')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Materials' })).toHaveAttribute('href', '/materials?view=no-required');
  });

  it('searches by item, code or location', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'stores' } });
    expect(screen.getByText('Flap disc')).toBeInTheDocument();
    expect(screen.queryByText('Grinding disc')).not.toBeInTheDocument();
  });

  it('downloads the re-order list as Excel or PDF, and reports a failure', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    downloadAs('Excel (.xlsx)');
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(undefined));
    downloadAs('PDF (.pdf)');
    await waitFor(() => expect(mockPdf).toHaveBeenCalledWith(undefined));
    mockDownload.mockRejectedValueOnce(new Error('Request failed (500)'));
    downloadAs('Excel (.xlsx)');
    expect(await screen.findByText('Request failed (500)')).toBeInTheDocument();
  });

  it('downloads the re-order list for the chosen category, and none for a category with nothing to re-order', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'CONSUMABLES' } });
    downloadAs('PDF (.pdf)');
    await waitFor(() => expect(mockPdf).toHaveBeenCalledWith('CONSUMABLES'));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'TOOLS' } });
    expect(screen.getByRole('button', { name: 'Download re-order list' })).toBeDisabled();
  });

  it('offers no download when nothing needs re-ordering', async () => {
    mockGet.mockResolvedValue(ROWS.filter((r) => r.status === 'OK'));
    renderPage();
    await screen.findByText('Nothing needs re-ordering');
    expect(screen.getByRole('button', { name: 'Download re-order list' })).toBeDisabled();
  });

  it('shows a tool out on loan beside what is on hand', async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : [{ ...row('TL-1', 'Torque wrench', 'WARNING', '0', '10', 20, '8'), category: 'TOOLS', onLoan: '2' }]));
    renderPage();
    expect(await screen.findByText('+2 checked out')).toBeInTheDocument();
  });

  it('opens on the view a link asks for', async () => {
    render(<MemoryRouter initialEntries={['/reports/stock-status?view=OK']}><ToastProvider><StockStatus /></ToastProvider></MemoryRouter>);
    expect(await screen.findByText('Cutting disc')).toBeInTheDocument();
    expect(screen.queryByText('Grinding disc')).not.toBeInTheDocument();
  });

  it('says the bands as set under Settings, and links there for an admin', async () => {
    perms.admin = true;
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values')
      ? { 'inventory.urgentBelowPercent': 25, 'inventory.warningBelowPercent': 50 }
      : ROWS));
    renderPage();
    expect(await screen.findByText(/urgent below 25%/)).toBeInTheDocument();
    expect(screen.getByText(/warning below 50%/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings → Inventory' })).toHaveAttribute('href', '/settings/inventory');
  });

  it('falls back to 20% and 40% when the bands cannot be read, without a link for others', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/settings/values')) throw { code: 'INTERNAL_ERROR', message: 'down' };
      return ROWS;
    });
    renderPage();
    expect(await screen.findByText(/urgent below 20%/)).toBeInTheDocument();
    expect(screen.getByText(/warning below 40%/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings → Inventory' })).not.toBeInTheDocument();
  });

  it('labels its search and filters', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    for (const label of ['Search', 'Show', 'Category']) {
      expect(screen.getByText(label, { selector: 'label' })).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});

describe('StockStatus links', () => {
  beforeEach(() => {
    perms.admin = false;
    perms.receive = false;
    mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : [...ROWS, row('GONE', 'Empty bin', 'URGENT', '0', '10', 0, '10')]));
  });

  function renderAt(url: string) {
    render(<MemoryRouter initialEntries={[url]}><ToastProvider><StockStatus /></ToastProvider></MemoryRouter>);
  }

  it('shows only the items with nothing on hand under ?view=out, as the Dashboard card counts them', async () => {
    renderAt('/reports/stock-status?view=out');
    expect(await screen.findByText('Empty bin')).toBeInTheDocument();
    expect(screen.queryByText('Grinding disc')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show')).toHaveValue('out');
  });

  // Receiving is on Receive stock and new orders on Order stock; ordering from here is Order these.
  it('offers neither Receive stock nor New stock order, even to those who can', async () => {
    perms.receive = true;
    renderAt('/reports/stock-status');
    await screen.findByText('Grinding disc');
    expect(screen.queryByRole('link', { name: /Receive stock/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New stock order/ })).not.toBeInTheDocument();
  });
});

// What is on approved Stores orders is still to come: shown, taken off the
// re-order quantity, and listed to chase rather than order again.
describe('StockStatus on order', () => {
  const order = (id: string, outstanding: string, dueDate: string | null) => ({ purchaseOrderId: `po-${id}`, number: `AFRI-${id}`, outstanding, dueDate });
  const ON_ORDER = [
    // 89 short; 30 on order, part overdue: 59 still to order.
    { ...row('DISC', 'Grinding disc', 'URGENT', '11', '100', 11, '59'), onOrder: '30', orders: [order('0007', '10', '2026-11-10'), order('0009', '20', '2026-11-30')] },
    // 40 short, all of it on order: nothing left to order.
    { ...row('FLAP', 'Flap disc', 'WARNING', '10', '50', 20, '0', 'Stores'), onOrder: '40', orders: [order('0008', '40', null)] },
    { ...row('CUT', 'Cutting disc', 'OK', '167', '100', 167, '0'), onOrder: '0', orders: [] },
  ];

  beforeEach(() => {
    features.procurement = true;
    perms.receive = false;
    mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : ON_ORDER));
  });

  const renderAt = (url = '/reports/stock-status') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><StockStatus /></ToastProvider></MemoryRouter>);
  const cellOf = (name: string, header: string) => {
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    return screen.getByText(name).closest('tr')!.querySelectorAll('td')[headers.indexOf(header)]!;
  };
  const show = (label: string) => fireEvent.change(screen.getByLabelText('Show'), { target: { value: label } });

  it('shows what is on order after On hand, with each order and when it is due, an overdue one flagged', async () => {
    renderAt();
    await screen.findByText('Grinding disc');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.indexOf('On order')).toBe(headers.indexOf('On hand') + 1);
    const disc = cellOf('Grinding disc', 'On order');
    expect(disc).toHaveTextContent('30');
    const late = within(disc).getByText(/AFRI-0007/).closest('div')!;
    expect(late).toHaveTextContent(/AFRI-0007 · 10 · overdue, was due/);
    expect(late).toHaveClass('text-danger-600');
    const due = within(disc).getByText(/AFRI-0009/).closest('div')!;
    expect(due).toHaveTextContent(/AFRI-0009 · 20 · due/);
    expect(due).not.toHaveClass('text-danger-600');
    // Only someone who orders stock opens the order.
    expect(within(disc).queryByRole('link')).not.toBeInTheDocument();
  });

  it('links each order for someone who orders stock', async () => {
    perms.receive = true; // grants every permission in this file's mock
    renderAt();
    await screen.findByText('Grinding disc');
    expect(within(cellOf('Grinding disc', 'On order')).getByRole('link', { name: 'AFRI-0007' })).toHaveAttribute('href', '/stock/orders/po-0007');
  });

  it('lists as needing re-ordering only what is still short after what is on order', async () => {
    renderAt();
    await screen.findByText('Grinding disc');
    expect(within(cellOf('Grinding disc', 'Re-order qty')).getByText('59')).toBeInTheDocument();
    expect(screen.queryByText('Flap disc')).not.toBeInTheDocument();
  });

  it('lists what is short but on order, and what is overdue, to chase', async () => {
    renderAt();
    await screen.findByText('Grinding disc');
    show('on-order');
    expect(screen.getByText('Grinding disc')).toBeInTheDocument();
    expect(screen.getByText('Flap disc')).toBeInTheDocument();
    expect(screen.queryByText('Cutting disc')).not.toBeInTheDocument();
    show('overdue');
    expect(screen.getByText('Grinding disc')).toBeInTheDocument();
    expect(screen.queryByText('Flap disc')).not.toBeInTheDocument();
  });

  it('lists everything with an order still to come as pending, whatever its status', async () => {
    const rows = [...ON_ORDER, { ...row('BOLT', 'Bolt M12', 'OK', '80', '50', 160, '0'), onOrder: '20', orders: [order('0010', '20', '2026-12-01')] }];
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : rows));
    renderAt();
    await screen.findByText('Grinding disc');
    expect(within(screen.getByLabelText('Show')).getByRole('option', { name: 'Pending orders (in transit)' })).toBeInTheDocument();
    show('pending');
    expect(screen.getByText('Grinding disc')).toBeInTheDocument();
    expect(screen.getByText('Flap disc')).toBeInTheDocument();
    expect(screen.getByText('Bolt M12')).toBeInTheDocument();
    expect(screen.queryByText('Cutting disc')).not.toBeInTheDocument();
  });

  it('opens on a view from the address, as the Dashboard links', async () => {
    renderAt('/reports/stock-status?view=overdue');
    await screen.findByText('Grinding disc');
    expect(screen.getByLabelText('Show')).toHaveValue('overdue');
  });

  // Qodo, PR #134: the order is left out for someone who can't open Stores orders, and one
  // order can have two lines of the item due the same day.
  it('shows an order it may not name, and two lines of one order due the same day', async () => {
    const lines = [order('0011', '5', '2026-11-30'), order('0011', '7', '2026-11-30'), { purchaseOrderId: null, number: null, outstanding: '3', dueDate: '2026-11-20' }];
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : [{ ...ON_ORDER[0]!, onOrder: '15', orders: lines }]));
    renderAt();
    await screen.findByText('Grinding disc');
    const cell = cellOf('Grinding disc', 'On order');
    expect(within(cell).getAllByText(/AFRI-0011/)).toHaveLength(2);
    expect(within(cell).getByText(/An order/)).toHaveTextContent('An order · 3 · due');
  });

  // Qodo, PR #134: the download holds what is still to order.
  it("doesn't offer the download when every short item is all on order", async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : [ON_ORDER[1]!, ON_ORDER[2]!]));
    renderAt();
    await screen.findByLabelText('Show');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download re-order list' })).toBeDisabled());
  });

  it('has no On order column or views with procurement off', async () => {
    features.procurement = false;
    renderAt('/reports/stock-status?view=overdue');
    await screen.findByText('Grinding disc');
    expect(screen.queryByRole('columnheader', { name: 'On order' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show')).toHaveValue('attention');
    expect(within(screen.getByLabelText('Show')).queryByRole('option', { name: 'Short, on order' })).not.toBeInTheDocument();
  });
});
