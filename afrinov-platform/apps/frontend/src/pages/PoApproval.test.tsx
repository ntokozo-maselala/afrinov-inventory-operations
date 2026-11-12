// Signing an order: Approve only for someone it is waiting on, who can sign it,
// and only the actions each role may take. Signed in through the auth mock, so the real
// permission table decides.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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
  id: 'po-1', number: 'PO-2026-0007', status, supplierId: 's-1', supplier: { name: 'Hydac' }, projectNumber: 'AFRI-1325', createdAt: '2026-10-19T08:00:00Z',
  currency: 'ZAR', vatRate: '15', totals: { subtotal: '600000.00', vat: '90000.00', net: '690000.00', unpricedLines: 0 },
  lines: [{ id: 'l-1', materialId: 'm-1', material: { sku: 'PUMP-1', name: 'Hydraulic pump', unitOfMeasure: 'each' }, orderedQty: '1', receivedQty: '0', unitPrice: '600000', subtotal: '600000.00', vat: '90000.00', net: '690000.00' }],
});
const SENIOR = { id: 'u-sb', name: 'Simbongile Bantubani', standIn: false };
const MANAGER_STEP = { step: 'MANAGER', label: 'Procurement Manager', signature: null };
const DIRECTOR_STEP = { step: 'DIRECTOR', label: 'Director', signature: null };
const approval = (over: Record<string, unknown> = {}) => ({
  subtotal: '600000.00', vat: '90000.00', net: '690000.00', unpricedLines: 0, currency: 'ZAR',
  canApprove: false, reason: null, randValue: '600000.00', exchangeRate: null, noRate: false,
  steps: [MANAGER_STEP, DIRECTOR_STEP], next: { step: 'MANAGER', label: 'Procurement Manager' }, approvers: [SENIOR], ...over,
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

function Where() { return <p data-testid="at">{useLocation().pathname}</p>; }
const page = (roles: string[], url = '/purchase-orders/po-1') => {
  signedIn.roles = roles;
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Routes>
          <Route path="/purchase-orders/:id" element={<><PurchaseOrderDetail /><Where /></>} />
          <Route path="/stock/orders/:id" element={<><PurchaseOrderDetail /><Where /></>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
};
const button = (name: string) => screen.queryByRole('button', { name });

describe('signing an order', () => {
  it('offers Approve to the last signature the order needs', async () => {
    current.approval = approval({ canApprove: true, steps: [MANAGER_STEP] });
    page(['PROCUREMENT_MANAGER']);
    await screen.findByText(/You can sign this order/);
    fireEvent.click(button('Approve')!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => /^Approve/.test(b.textContent ?? ''))!);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-1/approve', {}));
  });

  it('offers Sign to the Manager when the Director signs after, and says who is next', async () => {
    current.approval = approval({ canApprove: true });
    page(['PROCUREMENT_MANAGER']);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/The Director signs next/).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/purchase-orders/po-1/approve', {}));
  });

  it('shows the value excluding VAT that decides who signs, and each signature', async () => {
    current.approval = approval({
      next: { step: 'DIRECTOR', label: 'Director' }, reason: 'You have already signed this order. It is waiting on the Director.',
      steps: [{ ...MANAGER_STEP, signature: { name: 'Ona Moloane', signedAt: '2026-11-02T09:00:00Z', standIn: false } }, DIRECTOR_STEP],
    });
    page(['PROCUREMENT_MANAGER']);
    expect(await screen.findByText(/Approval for R\s600\s000,00 excluding VAT/)).toBeInTheDocument();
    expect(screen.getByText(/Procurement Manager: signed by Ona Moloane/)).toBeInTheDocument();
    expect(screen.getByText(/Director: waiting/)).toBeInTheDocument();
    expect(screen.getByText(/You have already signed this order/)).toBeInTheDocument();
    expect(screen.getByText(/Can sign next: Simbongile Bantubani\./)).toBeInTheDocument();
    expect(button('Approve')).not.toBeInTheDocument();
    expect(button('Sign')).not.toBeInTheDocument();
  });

  it('marks stand-ins, and shows the rate on an order in another currency', async () => {
    current.approval = approval({
      currency: 'USD', subtotal: '100.00', exchangeRate: '18.5', randValue: '1850.00', steps: [{ ...MANAGER_STEP, signature: null }],
      approvers: [SENIOR, { id: 'u-ws', name: 'Workshop Boss', standIn: true }],
    });
    page(['PROCUREMENT']);
    expect(await screen.findByText(/Can sign next: Simbongile Bantubani, Workshop Boss \(standing in\)\./)).toBeInTheDocument();
    expect(screen.getByText(/Approval for R\s1\s850,00 excluding VAT .*at R18\.5/)).toBeInTheDocument();
  });

  it('waits for prices before anyone can approve', async () => {
    current.approval = approval({ unpricedLines: 2, approvers: [], steps: [], next: null, randValue: null });
    page(['PROCUREMENT']);
    expect(await screen.findByText('Waiting for prices')).toBeInTheDocument();
    expect(screen.getByText(/2 lines have no price/)).toBeInTheDocument();
    expect(button('Approve')).not.toBeInTheDocument();
  });

  it('waits for an exchange rate', async () => {
    current.approval = approval({ currency: 'EUR', noRate: true, approvers: [], steps: [], next: null, randValue: null });
    page(['PROCUREMENT']);
    expect(await screen.findByText('Waiting for an exchange rate')).toBeInTheDocument();
  });

  it('says so when nobody holds the role', async () => {
    current.approval = approval({ approvers: [] });
    page(['PROCUREMENT']);
    expect(await screen.findByText(/Nobody holds the Procurement Manager role yet/)).toBeInTheDocument();
  });
});

describe('the record of who signed', () => {
  it('names each signer on an approved order, and marks a stand-in', async () => {
    current.po = {
      ...order('APPROVED'), approvedAt: '2026-11-03T09:00:00Z', approvedBy: { id: 'u-c', name: 'Chief Executive' },
      signatures: [
        { step: 'MANAGER', signedAt: '2026-11-02T09:00:00Z', standIn: false, signedBy: { id: 'u-o', name: 'Ona Moloane' } },
        { step: 'DIRECTOR', signedAt: '2026-11-03T09:00:00Z', standIn: true, signedBy: { id: 'u-c', name: 'Chief Executive' } },
      ],
    } as typeof current.po;
    page(['PROCUREMENT']);
    expect(await screen.findByText('by Ona Moloane (Procurement Manager), then Chief Executive (standing in for the Director)')).toBeInTheDocument();
  });

  it('names the role, not the person, where whoever signed doesn\'t hold it, as an admin testing', async () => {
    current.po = {
      ...order('APPROVED'), approvedAt: '2026-11-03T09:00:00Z', approvedBy: { id: 'u-a', name: 'System Administrator', roles: ['ADMIN'] },
      signatures: [{ step: 'MANAGER', signedAt: '2026-11-02T09:00:00Z', standIn: false, signedBy: { id: 'u-a', name: 'System Administrator', roles: ['ADMIN'] } }],
    } as typeof current.po;
    page(['PROCUREMENT']);
    expect(await screen.findByText('by Procurement Manager')).toHaveAttribute('title', 'System Administrator');
  });

  it('names whoever approved it without signing, as well as who signed', async () => {
    current.po = {
      ...order('APPROVED'), approvedAt: '2026-11-03T09:00:00Z', approvedBy: { id: 'u-2', name: 'Second Person' },
      signatures: [{ step: 'MANAGER', signedAt: '2026-11-02T09:00:00Z', standIn: false, signedBy: { id: 'u-o', name: 'Ona Moloane' } }],
    } as typeof current.po;
    page(['PROCUREMENT']);
    expect(await screen.findByText('by Ona Moloane (Procurement Manager), approved by Second Person')).toBeInTheDocument();
  });

  it('says in the Activity who stood in, and when signatures were cleared', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/po-1') return current.po;
      if (path === '/purchase-orders/po-1/approval') return current.approval;
      if (path === '/purchase-orders/po-1/history') return [
        { id: 'a', action: 'PO_SIGN', entityId: 'po-1', entityType: 'PurchaseOrder', actorId: 'u', actorName: 'Workshop Boss', before: { status: 'PENDING_APPROVAL' }, after: { status: 'PENDING_APPROVAL', step: 'MANAGER', standIn: true }, createdAt: '2026-11-02T09:00:00Z' },
        { id: 'b', action: 'UPDATE', entityId: 'po-1', entityType: 'PurchaseOrder', actorId: 'u', actorName: 'Buyer', before: {}, after: { signaturesCleared: true }, createdAt: '2026-11-02T10:00:00Z' },
      ];
      return [];
    });
    page(['PROCUREMENT']);
    expect(await screen.findByText('Signed as Procurement Manager (standing in)')).toBeInTheDocument();
    expect(screen.getByText('Details updated: signatures cleared, as the money changed')).toBeInTheDocument();
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

  it('a store controller receives an approved Stores order', async () => {
    current.po = { ...order('APPROVED'), projectNumber: null } as unknown as typeof current.po;
    page(['STORE_CONTROLLER'], '/stock/orders/po-1');
    await screen.findByText('Hydraulic pump');
    expect(button('Receive delivery')).toBeInTheDocument();
  });

  // Stores and Procurement Separation Roadmap, Phase 3: project material goes to site.
  // Project Material Through the Store Roadmap, Phase 2: the store receives a
  // project order (on Receive stock), but it stays Procurement's to change.
  it('a store controller may receive a project order, but not edit it', async () => {
    current.po = order('APPROVED');
    page(['STORE_CONTROLLER']);
    await screen.findByText('Hydraulic pump');
    expect(button('Receive delivery')).toBeInTheDocument();
    expect(button('Edit')).not.toBeInTheDocument();
  });

  // Stores ordering roadmap: an order without a project is the store's.
  it('a store controller edits and cancels a Stores order, listed under Order stock', async () => {
    current.po = { ...order('APPROVED'), projectNumber: null } as unknown as typeof current.po;
    page(['STORE_CONTROLLER'], '/stock/orders/po-1');
    await screen.findByText('Hydraulic pump');
    expect(button('Edit')).toBeInTheDocument();
    expect(button('Cancel PO')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Order stock' })).toHaveAttribute('href', '/stock/orders');
  });

  it('procurement opens a Stores order, and changes nothing on it', async () => {
    current.po = { ...order('DRAFT'), projectNumber: null } as unknown as typeof current.po;
    page(['PROCUREMENT'], '/stock/orders/po-1');
    await screen.findByText('Hydraulic pump');
    for (const name of ['Edit', 'Cancel PO', 'Submit for approval']) expect(button(name)).not.toBeInTheDocument();
  });

  // Stores and Procurement Separation Roadmap: each order at its own section's address.
  it('moves a Stores order opened under Procurement to Order stock', async () => {
    current.po = { ...order('APPROVED'), projectNumber: null } as unknown as typeof current.po;
    page(['STORE_CONTROLLER']);
    await screen.findByText('Hydraulic pump');
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/stock/orders/po-1'));
  });

  it('moves a project order opened under Order stock to Procurement', async () => {
    current.po = order('APPROVED');
    page(['PROCUREMENT'], '/stock/orders/po-1');
    await screen.findByText('Hydraulic pump');
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/purchase-orders/po-1'));
    expect(screen.getByRole('link', { name: 'Purchase orders' })).toHaveAttribute('href', '/purchase-orders');
  });
});
