// Giving approvers somewhere to start (procurement workflow Phase 5): the
// Purchase orders list's "Waiting for my approval" view, which the server
// works out from the approver's limit, and where approvers land.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), auth: { roles: ['APPROVER'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Ona', roles: auth.roles } }) }));

const { PurchaseOrders } = await import('./PurchaseOrders');

const order = (id: string, number: string, status: string) => ({
  id, number, status, supplier: { name: 'Hydac' }, createdAt: '2026-10-01T08:00:00Z', lines: [],
});
const MINE = [order('po-1', 'AFRI-0101', 'PENDING_APPROVAL')];
const ALL = [...MINE, order('po-2', 'AFRI-0102', 'PENDING_APPROVAL'), order('po-3', 'AFRI-0103', 'APPROVED')];

beforeEach(() => {
  auth.roles = ['APPROVER'];
  mockGet.mockReset().mockImplementation(async (path: string) => (path === '/purchase-orders?awaitingMyApproval=true' ? MINE : ALL));
});

const list = (url = '/purchase-orders') => render(
  <MemoryRouter initialEntries={[url]}><Routes><Route path="/purchase-orders" element={<PurchaseOrders />} /></Routes></MemoryRouter>,
);

describe('Waiting for my approval', () => {
  it('is where an approver opens the list, from the server’s choice of orders', async () => {
    list();
    expect(await screen.findByText('AFRI-0101')).toBeInTheDocument();
    expect(screen.queryByText('AFRI-0102')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter by status')).toHaveValue('mine');
    expect(mockGet).toHaveBeenCalledWith('/purchase-orders?awaitingMyApproval=true');
  });

  it('can be left for all statuses, and back', async () => {
    list();
    await screen.findByText('AFRI-0101');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '' } });
    expect(await screen.findByText('AFRI-0103')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'mine' } });
    await waitFor(() => expect(screen.queryByText('AFRI-0103')).not.toBeInTheDocument());
  });

  it('says when nothing is waiting', async () => {
    mockGet.mockImplementation(async (path: string) => (path === '/purchase-orders?awaitingMyApproval=true' ? [] : ALL));
    list();
    expect(await screen.findByText('Nothing is waiting for your approval')).toBeInTheDocument();
  });

  it('is not offered to those who do not approve, even from a link', async () => {
    auth.roles = ['STORE_CONTROLLER'];
    list('/purchase-orders?status=mine');
    expect(await screen.findByText('AFRI-0103')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Waiting for my approval' })).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/purchase-orders?awaitingMyApproval=true');
  });
});
