// Stores → Order stock (Stores ordering roadmap, Phase 2): the store's own
// orders, those without a project, and New order for the storeman only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), auth: { roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Sipho Storeman', roles: auth.roles } }) }));

const { StoresOrders } = await import('./StoresOrders');

const order = (id: string, number: string, status: string, supplier: string) => ({
  id, number, status, supplier: { name: supplier }, projectNumber: null, createdAt: '2026-10-28T08:00:00Z', currency: 'ZAR',
  totals: { subtotal: '100.00', vat: '15.00', net: '115.00', unpricedLines: 0 },
  lines: [{ id: `${id}-l`, material: { sku: 'DISC', name: 'Cutting disc' }, orderedQty: '10', receivedQty: '0' }],
});

beforeEach(() => {
  auth.roles = ['STORE_CONTROLLER'];
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders?awaitingMyApproval=true&kind=stores') return [order('po-5', 'AFRI-0205', 'PENDING_APPROVAL', 'Hydac')];
    if (path === '/purchase-orders?kind=stores') {
      return [
        order('po-1', 'AFRI-0201', 'DRAFT', 'Hydac'), order('po-2', 'AFRI-0202', 'APPROVED', 'Weldco'),
        order('po-3', 'AFRI-0203', 'PARTIALLY_RECEIVED', 'Weldco'), order('po-4', 'AFRI-0204', 'RECEIVED', 'Hydac'),
      ];
    }
    return [];
  });
});

const page = (url = '/stock/orders') => render(<MemoryRouter initialEntries={[url]}><StoresOrders /></MemoryRouter>);

describe('Order stock', () => {
  it("lists the store's orders, asking the server for Stores orders only", async () => {
    page();
    expect(await screen.findByRole('link', { name: 'AFRI-0201' })).toHaveAttribute('href', '/stock/orders/po-1');
    expect(screen.getByRole('link', { name: 'AFRI-0202' })).toBeInTheDocument();
    expect(mockGet.mock.calls.map((c) => c[0])).toContain('/purchase-orders?kind=stores');
  });

  it('filters by status and by supplier', async () => {
    page();
    await screen.findByRole('link', { name: 'AFRI-0201' });
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'APPROVED' } });
    expect(screen.queryByRole('link', { name: 'AFRI-0201' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AFRI-0202' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search stock orders'), { target: { value: 'hydac' } });
    expect(screen.getByRole('link', { name: 'AFRI-0201' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AFRI-0202' })).not.toBeInTheDocument();
  });

  // What the store is still waiting for, and receiving it from here.
  it('lists what is on order, and offers Receive on those orders only', async () => {
    page();
    await screen.findByRole('link', { name: 'AFRI-0201' });
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'APPROVED,PARTIALLY_RECEIVED' } });
    expect(screen.getByRole('link', { name: 'AFRI-0202' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AFRI-0203' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AFRI-0201' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AFRI-0204' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Receive AFRI-0202' })).toHaveAttribute('href', '/stock/receive?order=po-2');
    expect(screen.getByRole('link', { name: 'Receive AFRI-0203' })).toHaveAttribute('href', '/stock/receive?order=po-3');

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '' } });
    expect(screen.queryByRole('link', { name: 'Receive AFRI-0201' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Receive AFRI-0204' })).not.toBeInTheDocument();
  });

  // Stores and Procurement Separation Roadmap, Phase 2: the storeman approves the store's orders here.
  it("lists the storeman's orders waiting for his approval, from the server's choice", async () => {
    page('/stock/orders?status=mine');
    expect(await screen.findByRole('link', { name: 'AFRI-0205' })).toHaveAttribute('href', '/stock/orders/po-5');
    expect(screen.queryByRole('link', { name: 'AFRI-0201' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter by status')).toHaveValue('mine');
  });

  it('says when nothing is waiting for his approval', async () => {
    mockGet.mockImplementation(async (path: string) => (path === '/purchase-orders?kind=stores' ? [order('po-1', 'AFRI-0201', 'DRAFT', 'Hydac')] : []));
    page('/stock/orders?status=mine');
    expect(await screen.findByText('Nothing is waiting for your approval')).toBeInTheDocument();
  });

  it('offers New order to the storeman', async () => {
    page();
    expect(await screen.findByRole('link', { name: /New order/ })).toHaveAttribute('href', '/stock/orders/new');
  });

  it.each(['PROCUREMENT', 'APPROVER'])("keeps the store's orders from a %s", async (role) => {
    auth.roles = [role];
    page();
    expect(await screen.findByText(/Your role cannot see the store's orders/)).toBeInTheDocument();
    expect(mockGet.mock.calls.map((c) => c[0])).not.toContain('/purchase-orders?kind=stores');
  });

  it('keeps them from those who may not see orders', async () => {
    auth.roles = ['TECHNICIAN'];
    page();
    expect(await screen.findByText(/Your role cannot see the store's orders/)).toBeInTheDocument();
    expect(mockGet.mock.calls.map((c) => c[0])).not.toContain('/purchase-orders?kind=stores');
  });
});
