// The order's Activity reads as plain words: statuses by their labels, who did
// each step by name, and each delivery by the receipt it was booked on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Store', roles: ['STORE_CONTROLLER'] } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { PurchaseOrderDetail } = await import('./PurchaseOrderDetail');
const { ToastProvider } = await import('../components/Toast');

const ORDER = {
  id: 'po-1', number: 'AFRI-0412', status: 'PARTIALLY_RECEIVED', supplierId: 's-1', supplier: { name: 'Hydac' }, createdAt: '2026-10-01T08:00:00Z',
  currency: 'ZAR', vatRate: '15', totals: { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0 },
  lines: [{ id: 'pol-1', materialId: 'm-1', orderedQty: '10', receivedQty: '6', unitPrice: '1', material: { sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each' } }],
};

const entry = (id: string, at: string, action: string, actorName: string | null, before: object | null, after: object | null) =>
  ({ id, action, entityType: 'PurchaseOrder', entityId: 'po-1', actorId: 'u-1', actorName, before, after, createdAt: at });

const HISTORY = [
  entry('a1', '2026-10-01T08:00:00Z', 'CREATE', 'Buyer One', null, { number: 'AFRI-0412', status: 'DRAFT' }),
  entry('a2', '2026-10-01T09:00:00Z', 'PO_SUBMIT', 'Buyer One', { status: 'DRAFT' }, { status: 'PENDING_APPROVAL' }),
  entry('a3', '2026-10-01T10:00:00Z', 'PO_APPROVE', 'Approver Two', { status: 'PENDING_APPROVAL' }, { status: 'APPROVED' }),
  entry('a4', '2026-10-02T08:00:00Z', 'PO_GOODS_RECEIVED', 'Store Three', { status: 'APPROVED' }, { status: 'PARTIALLY_RECEIVED', goodsReceiptNumber: 'GR-2026-0007' }),
  entry('a5', '2026-10-03T08:00:00Z', 'PO_GOODS_RECEIVED', null, { status: 'PARTIALLY_RECEIVED' }, { status: 'PARTIALLY_RECEIVED', goodsReceiptNumber: 'GR-2026-0008' }),
];

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders/po-1') return ORDER;
    if (path === '/purchase-orders/po-1/history') return HISTORY;
    if (path.endsWith('/approval')) return { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0, currency: 'ZAR', canApprove: false, reason: null, myLimit: null, approvers: [] };
    return [];
  });
});

describe('the order Activity', () => {
  it('shows each step in plain words, with who did it, from the order being created to each delivery', async () => {
    render(
      <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
        <ToastProvider><Routes><Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} /></Routes></ToastProvider>
      </MemoryRouter>,
    );
    const items = within((await screen.findByText('Purchase order created')).closest('ol')!).getAllByRole('listitem');
    // Newest first.
    expect(items.map((li) => li.querySelector('.font-medium')!.textContent)).toEqual([
      'Received on GR-2026-0008',
      'Received on GR-2026-0007: Approved → Partly received',
      'Approved: Pending approval → Approved',
      'Submitted for approval: Draft → Pending approval',
      'Purchase order created',
    ]);
    expect(items[1]).toHaveTextContent('Store Three');
    expect(items[2]).toHaveTextContent('Approver Two');
    expect(items[4]).toHaveTextContent('Buyer One');
    // An account that no longer exists is not shown as its id.
    expect(items[0]).toHaveTextContent('A removed user');
    expect(screen.queryByText(/u-1/)).not.toBeInTheDocument();
  });
});
