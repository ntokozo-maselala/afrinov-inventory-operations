// Approval by order value (procurement roadmap Phase 4): Approve only for
// someone whose limit covers the order, who can approve it, and only the
// actions each role may take. Signed in through the auth mock, so the real
// permission table decides.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch, signedIn } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(), signedIn: { roles: [] as string[] },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Someone', roles: signedIn.roles } }) }));
// The document itself is checked in lib/poDocument.test.ts; here only that the page asks for it.
vi.mock('../lib/poDocument', async (original) => ({ ...(await original<object>()), downloadPoDocument: vi.fn() }));

const { PurchaseOrderDetail } = await import('./PurchaseOrderDetail');
const { ToastProvider } = await import('../components/Toast');

const order = (status: string) => ({
  id: 'po-1', number: 'PO-2026-0007', status, supplierId: 's-1', supplier: { name: 'Hydac' }, createdAt: '2026-10-19T08:00:00Z',
  currency: 'ZAR', vatRate: '15', totals: { subtotal: '600000.00', vat: '90000.00', net: '690000.00', unpricedLines: 0 },
  lines: [{ id: 'l-1', materialId: 'm-1', material: { sku: 'PUMP-1', name: 'Hydraulic pump', unitOfMeasure: 'each' }, orderedQty: '1', receivedQty: '0', unitPrice: '600000', subtotal: '600000.00', vat: '90000.00', net: '690000.00' }],
});
const SENIOR = { id: 'u-sb', name: 'Simbongile Bantubani', approvalLimit: null };
const approval = (over: Record<string, unknown> = {}) => ({
  subtotal: '600000.00', vat: '90000.00', net: '690000.00', unpricedLines: 0, currency: 'ZAR',
  canApprove: false, reason: null, myLimit: null, approvers: [SENIOR], ...over,
});

let current = { po: order('PENDING_APPROVAL'), approval: approval() };

beforeEach(() => {
  current = { po: order('PENDING_APPROVAL'), approval: approval() };
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/purchase-orders/po-1') return current.po;
    if (path === '/purchase-orders/po-1/approval') return current.approval;
    if (path.startsWith('/locations')) return [{ id: 'loc-1', name: 'Main store', active: true }];
    return [];
  });
  mockPost.mockReset().mockResolvedValue({});
  mockPatch.mockReset().mockResolvedValue({});
});

const page = (roles: string[]) => {
  signedIn.roles = roles;
  render(
    <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
      <ToastProvider><Routes><Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );
};
const button = (name: string) => screen.queryByRole('button', { name });

describe('approving by value', () => {
  it('offers Approve to an approver whose limit covers the order', async () => {
    current.approval = approval({ canApprove: true });
    page(['APPROVER']);
    await screen.findByText(/You can approve this order/);
    fireEvent.click(button('Approve')!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => /^Approve/.test(b.textContent ?? ''))!);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-1/approve', {}));
  });

  it('says why not, and who can, when the order is over the approver\'s limit', async () => {
    current.approval = approval({ reason: 'This order is R 690 000,00 including VAT; your approval limit is R 500 000,00.', myLimit: '500000' });
    page(['APPROVER']);
    expect(await screen.findByText(/your approval limit is R 500 000,00\./)).toBeInTheDocument();
    expect(screen.getByText(/Can approve it: Simbongile Bantubani \(no limit\)/)).toBeInTheDocument();
    expect(button('Approve')).not.toBeInTheDocument();
  });

  it('waits for prices before anyone can approve', async () => {
    current.approval = approval({ unpricedLines: 2, approvers: [] });
    page(['PROCUREMENT']);
    expect(await screen.findByText('Waiting for prices')).toBeInTheDocument();
    expect(screen.getByText(/2 lines have no price/)).toBeInTheDocument();
    expect(button('Approve')).not.toBeInTheDocument();
  });

  it('says so when nobody has a high enough limit', async () => {
    current.approval = approval({ approvers: [] });
    page(['PROCUREMENT']);
    expect(await screen.findByText(/Nobody has a high enough approval limit/)).toBeInTheDocument();
  });
});

describe('the revision', () => {
  it('shows the order\'s revision next to its supplier', async () => {
    current.po = { ...order('APPROVED'), revision: 2 } as typeof current.po;
    page(['PROCUREMENT']);
    expect(await screen.findByText('Rev 02 · Supplier: Hydac')).toBeInTheDocument();
  });
});

describe('the purchase order document', () => {
  it('lets anyone who can open the order download it, with the company details from Settings', async () => {
    const { downloadPoDocument } = await import('../lib/poDocument');
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/po-1') return current.po;
      if (path === '/purchase-orders/po-1/approval') return current.approval;
      if (path.startsWith('/settings/values')) return { 'general.companyName': 'Afrinov', 'purchaseOrders.companyVatNumber': '4010288142' };
      return [];
    });
    page(['APPROVER']);
    await screen.findByText('Hydraulic pump');
    fireEvent.click(button('Download PDF')!);
    await waitFor(() => expect(downloadPoDocument).toHaveBeenCalledWith(
      expect.objectContaining({ number: 'PO-2026-0007' }),
      expect.objectContaining({ name: 'Afrinov', vatNumber: '4010288142' }),
    ));
    expect(mockGet).toHaveBeenCalledWith(expect.stringMatching(/^\/settings\/values\?keys=.*purchaseOrders\.companyVatNumber/));
  });
});

describe('only the actions each role may take', () => {
  it('an approver sees no Edit, Cancel or Close', async () => {
    page(['APPROVER']);
    await screen.findByText('Hydraulic pump');
    for (const name of ['Edit', 'Cancel PO', 'Close PO']) expect(button(name)).not.toBeInTheDocument();
  });

  it('procurement edits and cancels, but does not receive', async () => {
    current.po = order('APPROVED');
    page(['PROCUREMENT']);
    await screen.findByText('Hydraulic pump');
    expect(button('Edit')).toBeInTheDocument();
    expect(button('Cancel PO')).toBeInTheDocument();
    expect(button('Receive delivery')).not.toBeInTheDocument();
  });

  it('a store controller receives an approved order, and edits nothing', async () => {
    current.po = order('APPROVED');
    page(['STORE_CONTROLLER']);
    await screen.findByText('Hydraulic pump');
    expect(button('Receive delivery')).toBeInTheDocument();
    expect(button('Edit')).not.toBeInTheDocument();
  });
});
