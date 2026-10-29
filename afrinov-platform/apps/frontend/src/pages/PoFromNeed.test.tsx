// Starting an order from where the need shows (procurement workflow Phase 6):
// the new-order form filled in from its link, Order these on Stock status,
// New order on a supplier and Order on an item. Stores stock is ordered by
// the store, from Stores → Order stock (Stores ordering roadmap).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { mockGet, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), auth: { roles: ['PROCUREMENT'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Thandi Buyer', roles: auth.roles } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { NewPurchaseOrder, NewStockOrder } = await import('./PurchaseOrderForm');
const { StockStatus } = await import('./StockStatus');
const { SupplierDetail } = await import('./SupplierDetail');
const { MaterialDetail } = await import('./MaterialDetail');
const { ToastProvider } = await import('../components/Toast');

const material = (id: string, sku: string, unitCost: string | null, active = true) => ({
  id, sku, name: `Item ${sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '10', unitCost, active,
});
const MATERIALS = [material('m-1', 'DISC', '12.5'), material('m-2', 'BOLT', null), material('m-3', 'GLOVE', '30'), material('m-old', 'OLD', '1', false)];
const BEAM = { ...material('m-beam', 'BEAM', '900'), category: 'PROJECT_MATERIAL', requiredStock: '0', projectNumber: 'AFRI-1325', project: { projectNumber: 'AFRI-1325', status: 'ACTIVE' } };
const SUPPLIERS = [
  { id: 's-1', name: 'Hydac', active: true, currency: 'ZAR', paymentTerms: '30 DAYS NETT' },
  { id: 's-2', name: 'Weldco', active: true, currency: 'ZAR', paymentTerms: null },
];
const statusRow = (m: { id: string; sku: string }, reorder: string, lastSupplier: { id: string; name: string } | null) => ({
  materialId: m.id, sku: m.sku, name: `Item ${m.sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '10',
  onHand: '2', percentOfRequired: 20, status: 'URGENT', reorderQuantity: reorder, unitCost: null, locations: [],
  lastSupplier: lastSupplier && { ...lastSupplier, receivedAt: '2026-09-01T00:00:00.000Z' },
});
const STATUS = [
  statusRow(MATERIALS[0]!, '8', { id: 's-1', name: 'Hydac' }),
  statusRow(MATERIALS[1]!, '5', { id: 's-1', name: 'Hydac' }),
  statusRow(MATERIALS[2]!, '4', { id: 's-2', name: 'Weldco' }),
];

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  try { sessionStorage.clear(); } catch { /* not available */ }
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/suppliers') return SUPPLIERS;
    if (path === '/suppliers/s-1') return SUPPLIERS[0];
    if (path === '/materials') return [...MATERIALS, BEAM];
    if (path === '/materials/m-1') return MATERIALS[0];
    if (path === '/materials/m-beam') return BEAM;
    if (path === '/reports/stock-status') return STATUS;
    if (path.startsWith('/settings/values')) return { 'purchaseOrders.vatRate': 15 };
    return [];
  });
});

function Where() {
  const l = useLocation();
  return <p data-testid="at">{l.pathname + l.search}</p>;
}
const at = () => screen.getByTestId('at').textContent;

// The re-order list's items are Stores stock, so its link opens the store's order form.
const form = (query: string) => render(
  <MemoryRouter initialEntries={[`/stock/orders/new?${query}`]}>
    <ToastProvider><Routes><Route path="/stock/orders/new" element={<NewStockOrder />} /></Routes></ToastProvider>
  </MemoryRouter>,
);

const stockOrder = (query: string) => render(
  <MemoryRouter initialEntries={[`/stock/orders/new?${query}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/stock/orders/new" element={<NewStockOrder />} />
        <Route path="/stock/orders" element={<Where />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

describe('a new stock order (Stores → Order stock)', () => {
  beforeEach(() => { auth.roles = ['STORE_CONTROLLER']; });

  it('is filled in from the re-order list, with no project and Stores items only', async () => {
    stockOrder('supplierId=s-1&materialIds=m-1,m-beam');
    expect(await screen.findByLabelText('Line 1 material')).toHaveValue('m-1');
    // The Projects item is not the store's to order, so it is left off.
    expect(screen.queryByLabelText('Line 2 material')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New stock order' })).toBeInTheDocument();
    const options = within(screen.getByLabelText('Line 1 material')).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith('BEAM'))).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    expect(at()).toBe('/stock/orders');
  });

  it("opens Procurement's form on a Projects item's link, for its project", async () => {
    auth.roles = ['PROCUREMENT'];
    render(
      <MemoryRouter initialEntries={['/purchase-orders/new?materialIds=m-beam,m-1']}>
        <ToastProvider><Routes><Route path="/purchase-orders/new" element={<NewPurchaseOrder />} /></Routes></ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Line 1 material')).toHaveValue('m-beam');
    // The Stores item is the store's to order, so it is left off.
    expect(screen.queryByLabelText('Line 2 material')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Project/)).toHaveValue('AFRI-1325');
  });

  it('adds a new item only as a Stores item, which the drawer does not let be changed', async () => {
    stockOrder('');
    fireEvent.click(await screen.findByRole('button', { name: 'New item' }));
    const drawer = await screen.findByRole('dialog', { name: 'New item' });
    expect(within(drawer).getByRole('radio', { name: /Stores/ })).toBeChecked();
    expect(within(drawer).getByRole('radio', { name: /Projects/ })).toBeDisabled();
    expect(within(drawer).queryByLabelText('Project')).not.toBeInTheDocument();
    expect(within(drawer).getByText(/Set by the stock order/)).toBeInTheDocument();
  });

  it('is not for a buyer, who buys for projects', async () => {
    auth.roles = ['PROCUREMENT'];
    stockOrder('materialIds=m-1');
    expect(await screen.findByText(/Your role cannot order stock for the store/)).toBeInTheDocument();
  });
});

describe('the new-order form filled in from its link', () => {
  beforeEach(() => { auth.roles = ['STORE_CONTROLLER']; });

  it('fills in the supplier and the lines: up to Required Stock, priced from unit cost', async () => {
    form('supplierId=s-1&materialIds=m-1,m-2');
    expect(await screen.findByLabelText('Line 2 material')).toHaveValue('m-2');
    expect(screen.getByLabelText(/^Supplier(?! address)/)).toHaveValue('s-1');
    expect(screen.getByLabelText('Payment terms')).toHaveValue('30 DAYS NETT');
    expect(screen.getByLabelText('Line 1 material')).toHaveValue('m-1');
    expect(screen.getByLabelText('Line 1 quantity')).toHaveValue(8);
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue(12.5);
    expect(screen.getByLabelText('Line 2 quantity')).toHaveValue(5);
    expect(screen.getByLabelText('Line 2 unit price')).toHaveValue(null);
    expect(screen.getByText(/Filled in from what needs ordering/)).toBeInTheDocument();
  });

  it('suggests the items’ last supplier when they share one', async () => {
    form('materialIds=m-1,m-2');
    await screen.findByLabelText('Line 2 material');
    expect(screen.getByLabelText(/^Supplier(?! address)/)).toHaveValue('s-1');
  });

  it('leaves the supplier to choose when the items came from different ones', async () => {
    form('materialIds=m-1,m-3');
    await screen.findByLabelText('Line 2 material');
    expect(screen.getByLabelText(/^Supplier(?! address)/)).toHaveValue('');
  });

  it('skips unknown and inactive items', async () => {
    form('materialIds=m-old,nope,m-3');
    expect(await screen.findByLabelText('Line 1 material')).toHaveValue('m-3');
    expect(screen.queryByLabelText('Line 2 material')).not.toBeInTheDocument();
  });
});

const stockStatus = () => render(
  <MemoryRouter initialEntries={['/reports/stock-status']}>
    <ToastProvider>
      <Routes>
        <Route path="/reports/stock-status" element={<StockStatus />} />
        <Route path="/stock/orders/new" element={<Where />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

describe('Order these on Stock status', () => {
  // The re-order list is Stores stock, ordered by the store.
  beforeEach(() => { auth.roles = ['STORE_CONTROLLER']; });

  it('goes from ticked items to a filled-in order in two clicks', async () => {
    stockStatus();
    fireEvent.click(await screen.findByLabelText('Order DISC'));
    fireEvent.click(screen.getByLabelText('Order BOLT'));
    fireEvent.click(screen.getByRole('button', { name: 'Order these' }));
    expect(at()).toBe('/stock/orders/new?supplierId=s-1&materialIds=m-1%2Cm-2');
  });

  it('asks which supplier when the items came from more than one, and keeps the rest ticked', async () => {
    const { unmount } = stockStatus();
    fireEvent.click(await screen.findByLabelText('Tick every item shown'));
    fireEvent.click(screen.getByRole('button', { name: 'Order these' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /Hydac.*2 items: DISC, BOLT/ })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Weldco/ }));
    expect(at()).toBe('/stock/orders/new?supplierId=s-2&materialIds=m-3');
    unmount();

    stockStatus();
    expect(await screen.findByLabelText('Order DISC')).toBeChecked();
    expect(screen.getByLabelText('Order GLOVE')).not.toBeChecked();
    expect(screen.getByText('2 items ticked to order')).toBeInTheDocument();
  });

  it('offers no ticks to those who do not order Stores stock, buyers included', async () => {
    auth.roles = ['PROCUREMENT'];
    stockStatus();
    await screen.findByText('Item DISC');
    expect(screen.queryByLabelText('Order DISC')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New stock order/ })).not.toBeInTheDocument();
  });

  it('links the store to a new stock order', async () => {
    stockStatus();
    expect(await screen.findByRole('link', { name: /New stock order/ })).toHaveAttribute('href', '/stock/orders/new');
  });
});

describe('ordering from a supplier or an item', () => {
  it('New order on a supplier fills the supplier in', async () => {
    render(
      <MemoryRouter initialEntries={['/suppliers/s-1']}>
        <ToastProvider><Routes><Route path="/suppliers/:id" element={<SupplierDetail />} /></Routes></ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: /New order/ })).toHaveAttribute('href', '/purchase-orders/new?supplierId=s-1');
  });

  it("New order on a supplier opens the store's order form for the storeman", async () => {
    auth.roles = ['STORE_CONTROLLER'];
    render(
      <MemoryRouter initialEntries={['/suppliers/s-1']}>
        <ToastProvider><Routes><Route path="/suppliers/:id" element={<SupplierDetail />} /></Routes></ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: /New order/ })).toHaveAttribute('href', '/stock/orders/new?supplierId=s-1');
  });

  const item = (id: string) => render(
    <MemoryRouter initialEntries={[`/materials/${id}`]}>
      <ToastProvider><Routes><Route path="/materials/:id" element={<MaterialDetail />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );

  it("Order on a Stores item opens the store's order, filled in", async () => {
    auth.roles = ['STORE_CONTROLLER'];
    item('m-1');
    expect(await screen.findByRole('link', { name: 'Order' })).toHaveAttribute('href', '/stock/orders/new?materialIds=m-1');
  });

  it("Order on a Projects item opens Procurement's purchase order", async () => {
    item('m-beam');
    expect(await screen.findByRole('link', { name: 'Order' })).toHaveAttribute('href', '/purchase-orders/new?materialIds=m-beam');
  });

  it('a buyer is offered no Order on a Stores item, and New order on an item page is never offered', async () => {
    render(
      <MemoryRouter initialEntries={['/materials/m-1']}>
        <ToastProvider><Routes><Route path="/materials/:id" element={<MaterialDetail />} /></Routes></ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: 'Receive' });
    expect(screen.queryByRole('link', { name: 'Order' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: /New order/ })).not.toBeInTheDocument());
  });
});
