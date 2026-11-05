// A project order's delivery (Project Material Through the Store Roadmap,
// Phase 2): project material comes through the store, so the store receives
// it on Receive stock, into stock held for the project. Procurement's Confirm
// delivery is retired; confirmations made before still read on the Activity.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { roles: ['PROCUREMENT'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Thandi Buyer', roles: auth.roles } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));
vi.mock('../lib/poDocument', async (original) => ({ ...(await original<object>()), downloadPoDocument: vi.fn() }));

const { PurchaseOrderDetail } = await import('./PurchaseOrderDetail');
const { ToastProvider } = await import('../components/Toast');

const ORDER = {
  id: 'po-1', number: 'AFRI-0500', status: 'APPROVED', supplierId: 's-1', supplier: { name: 'EMV Africa' }, projectNumber: 'AFRI-1402',
  createdAt: '2026-10-20T08:00:00Z', currency: 'ZAR', vatRate: '15', totals: { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0 },
  lines: [
    { id: 'l-1', materialId: 'm-1', orderedQty: '10', receivedQty: '4', unitPrice: '1', material: { sku: '1402-RAIL', name: 'Door rail', unitOfMeasure: 'm' } },
  ],
};
const CONFIRMED_BEFORE = {
  id: 'a-1', action: 'PO_DELIVERY_CONFIRMED', entityId: 'po-1', entityType: 'PurchaseOrder', actorId: 'u-1', actor: { id: 'u-1', name: 'Thandi Buyer' },
  before: { status: 'APPROVED' }, after: { status: 'PARTIALLY_RECEIVED' }, createdAt: '2026-10-28T09:00:00Z',
};

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders/po-1') return ORDER;
    if (path === '/purchase-orders/po-1/history') return [CONFIRMED_BEFORE];
    if (path.endsWith('/approval')) return { subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 0, currency: 'ZAR', canApprove: false, reason: null, randValue: null, exchangeRate: null, noRate: false, steps: [], next: null, approvers: [] };
    return [];
  });
  mockPost.mockReset();
});

function Where() { const l = useLocation(); return <p data-testid="at">{l.pathname}{l.search}</p>; }

const page = () => render(
  <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
    <ToastProvider>
      <Routes>
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
        <Route path="/stock/receive" element={<Where />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

describe('a project order’s delivery', () => {
  it('offers the buyer no Confirm delivery: the store receives it', async () => {
    page();
    await screen.findByText('Door rail');
    expect(screen.queryByRole('button', { name: 'Confirm delivery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive delivery' })).not.toBeInTheDocument();
  });

  it('takes whoever receives orders to Receive stock, with the order chosen', async () => {
    auth.roles = ['ADMIN'];
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive delivery' }));
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/stock/receive?order=po-1'));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('still shows a delivery confirmed before on the Activity', async () => {
    page();
    expect(await screen.findByText(/Delivery confirmed on site/)).toBeInTheDocument();
  });

  // Qodo, PR #143: a confirmed delivery went to site, not into the store.
  describe('the date it was delivered', () => {
    const delivered = { ...ORDER, status: 'RECEIVED', deliveredAt: '2026-10-28T09:00:00Z', deliveredBy: { name: 'Thandi Buyer' } };
    const withHistory = (history: unknown[]) => mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/po-1') return delivered;
      if (path === '/purchase-orders/po-1/history') return history;
      return [];
    });
    // The status reads Received too; this is the date's label.
    const dateLabel = async () => {
      await screen.findByText('Door rail');
      return screen.getAllByText(/^(Received|Delivered to site)$/).find((e) => e.tagName === 'DT')?.textContent;
    };

    it('reads delivered to site when Confirm delivery finished the order', async () => {
      withHistory([{ ...CONFIRMED_BEFORE, after: { status: 'RECEIVED' } }]);
      page();
      await waitFor(async () => expect(await dateLabel()).toBe('Delivered to site'));
    });

    // Qodo, PR #143: the store's receipt set the date, not the earlier confirmation.
    it('reads received when a delivery partly confirmed on site was finished by a receipt', async () => {
      withHistory([CONFIRMED_BEFORE]);
      page();
      await screen.findByText(/Delivery confirmed on site/);
      expect(await dateLabel()).toBe('Received');
    });

    it('reads received for an order the store received', async () => {
      withHistory([]);
      page();
      expect(await dateLabel()).toBe('Received');
    });
  });
});
