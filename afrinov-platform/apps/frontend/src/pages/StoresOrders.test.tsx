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
    if (path === '/purchase-orders?kind=stores') {
      return [
        order('po-1', 'AFRI-0201', 'DRAFT', 'Hydac'), order('po-2', 'AFRI-0202', 'APPROVED', 'Weldco'),
        order('po-3', 'AFRI-0203', 'PARTIALLY_RECEIVED', 'Weldco'), order('po-4', 'AFRI-0204', 'RECEIVED', 'Hydac'),
      ];
    }
    return [];
  });
});

const page = () => render(<MemoryRouter><StoresOrders /></MemoryRouter>);

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
    expect(screen.getByRole('link', { name: 'Receive AFRI-0202' })).toHaveAttribute('href', '/stock/orders/po-2?receive=1');
    expect(screen.getByRole('link', { name: 'Receive AFRI-0203' })).toHaveAttribute('href', '/stock/orders/po-3?receive=1');

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '' } });
    expect(screen.queryByRole('link', { name: 'Receive AFRI-0201' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Receive AFRI-0204' })).not.toBeInTheDocument();
  });

  it('offers a buyer no Receive, as receiving is the store’s', async () => {
    auth.roles = ['PROCUREMENT'];
    page();
    await screen.findByRole('link', { name: 'AFRI-0202' });
    expect(screen.queryByRole('link', { name: /^Receive / })).not.toBeInTheDocument();
  });

  it('offers New order to the storeman', async () => {
    page();
    expect(await screen.findByRole('link', { name: /New order/ })).toHaveAttribute('href', '/stock/orders/new');
  });

  it('shows a buyer the orders, without New order', async () => {
    auth.roles = ['PROCUREMENT'];
    page();
    await screen.findByRole('link', { name: 'AFRI-0201' });
    expect(screen.queryByRole('link', { name: /New order/ })).not.toBeInTheDocument();
  });

  it('keeps them from those who may not see orders', async () => {
    auth.roles = ['TECHNICIAN'];
    page();
    expect(await screen.findByText(/Your role cannot see the store's orders/)).toBeInTheDocument();
    expect(mockGet.mock.calls.map((c) => c[0])).not.toContain('/purchase-orders?kind=stores');
  });
});
