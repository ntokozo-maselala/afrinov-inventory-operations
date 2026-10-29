// Comparing the quotes and awarding the RFQ (RFQ roadmap, Phase 5): prices
// side by side with the lowest on each line marked, the award raising a draft
// order, a reason asked for when it isn't the clear choice, and the order
// linking back to its RFQ.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, auth } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), auth: { roles: ['PROCUREMENT'] as string[] } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Buyer', roles: auth.roles } }) }));

const { RfqDetail } = await import('./RfqDetail');
const { PurchaseOrderDetail } = await import('./PurchaseOrderDetail');
const { ToastProvider } = await import('../components/Toast');

const lines = [
  { id: 'l-1', lineNo: 1, materialId: 'm-1', quantity: '4', material: { sku: 'WHEEL-SS', name: 'Overhead rail wheel', unitOfMeasure: 'LOTS' } },
  { id: 'l-2', lineNo: 2, materialId: 'm-2', quantity: '2', material: { sku: 'PIN-C', name: 'Clevis pin', unitOfMeasure: 'PC' } },
];
const quote = (id: string, name: string, prices: Record<string, string>, totals: { subtotal: string; vat: string; net: string; unpricedLines: number }, extra: Record<string, unknown> = {}) => ({
  supplierId: id, supplier: { id, name, currency: 'ZAR' }, declined: false, quotedAt: '2026-10-29T00:00:00.000Z', vatRate: 15,
  prices: Object.entries(prices).map(([rfqLineId, unitPrice]) => ({ rfqLineId, unitPrice })), totals, quoteFile: null, ...extra,
});
// EMV: both lines, 690 incl. VAT. Macsteel: both lines, 736. Hydac: line 1 only.
const EMV = quote('s-1', 'EMV Africa', { 'l-1': '140', 'l-2': '20' }, { subtotal: '600.00', vat: '90.00', net: '690.00', unpricedLines: 0 }, { leadTime: '2 weeks', validUntil: '2099-12-31T00:00:00.000Z' });
const MAC = quote('s-2', 'Macsteel', { 'l-1': '150', 'l-2': '20' }, { subtotal: '640.00', vat: '96.00', net: '736.00', unpricedLines: 0 }, { validUntil: '2026-01-31T00:00:00.000Z' });
const HYD = quote('s-3', 'Hydac', { 'l-1': '130' }, { subtotal: '520.00', vat: '78.00', net: '598.00', unpricedLines: 1 });
const AWAITING = { supplierId: 's-4', supplier: { id: 's-4', name: 'Afrox', currency: 'ZAR' }, declined: false, quotedAt: null, prices: [], totals: null };
const rfq = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'AFRI-02A-1325-02-02', status, closed: false, projectNumber: 'AFRI-1325', description: 'Door rails', notes: null,
  penaltiesApply: false, issuedAt: '2026-10-28T00:00:00.000Z', closingDate: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-28T08:00:00Z',
  lines, suppliers: [EMV, MAC, HYD, AWAITING], purchaseOrder: null, ...extra,
});
const AWARDED = rfq('AWARDED', { purchaseOrder: { id: 'po-9', number: 'AFRI-0042', status: 'DRAFT', supplierId: 's-1' }, awardedAt: '2026-10-29T09:00:00Z', awardedBy: { id: 'u-1', name: 'Buyer' } });
let current = rfq('SENT');

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  current = rfq('SENT');
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/rfqs/r-1') return current;
    if (path === '/purchase-orders/po-9') {
      return {
        id: 'po-9', number: 'AFRI-0042', status: 'DRAFT', supplierId: 's-1', supplier: { name: 'EMV Africa' }, createdAt: '2026-10-29T09:00:00Z',
        currency: 'ZAR', vatRate: '15', totals: { subtotal: '600.00', vat: '90.00', net: '690.00', unpricedLines: 0 }, lines: [], rfq: { id: 'r-1', number: 'AFRI-02A-1325-02-02' },
      };
    }
    if (path === '/purchase-orders/po-9/history') {
      return [{ id: 'h-1', action: 'CREATE', actorId: 'u-1', actorName: 'Buyer', before: null, after: { number: 'AFRI-0042', status: 'DRAFT', rfqNumber: 'AFRI-02A-1325-02-02' }, createdAt: '2026-10-29T09:00:00Z' }];
    }
    if (path.endsWith('/approval')) return { subtotal: '0', vat: '0', net: '0', unpricedLines: 0, currency: 'ZAR', canApprove: false, reason: null, myLimit: null, approvers: [] };
    return [];
  });
  mockPost.mockReset().mockResolvedValue(AWARDED);
});

const appAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <Routes>
        <Route path="/rfqs/:id" element={<RfqDetail />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);
const comparison = async () => screen.findByRole('table', { name: 'Quote comparison' });

describe('Comparing quotes', () => {
  it('sets the quotes side by side, marking the lowest on each line, what isn’t offered and what has run out', async () => {
    appAt('/rfqs/r-1');
    const table = await comparison();
    // Only suppliers who quoted have a column.
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Line', 'Qty', expect.stringContaining('EMV Africa'), expect.stringContaining('Macsteel'), expect.stringContaining('Hydac'),
    ]);
    const line1 = within(table).getByRole('rowheader', { name: /WHEEL-SS/ }).closest('tr')!;
    expect(within(line1).getByText(/lowest/)).toBeInTheDocument();
    expect(within(line1).getByText(/lowest/).closest('td')).toHaveTextContent('130');
    const line2 = within(table).getByRole('rowheader', { name: /PIN-C/ }).closest('tr')!;
    expect(within(line2).getByText('Not offered')).toBeInTheDocument();
    // EMV is the lowest complete quote; Hydac left a line out; Macsteel's quote has run out.
    const net = within(table).getByRole('rowheader', { name: 'Net value' }).closest('tr')!;
    expect(within(net).getByText(/lowest complete quote/).closest('td')).toHaveTextContent('690');
    expect(within(within(table).getByRole('rowheader', { name: 'Valid until' }).closest('tr')!).getByText(/Ran out/)).toBeInTheDocument();
  });

  it('awards the clear choice without a reason and opens its new order', async () => {
    appAt('/rfqs/r-1');
    fireEvent.click(within(await comparison()).getByRole('button', { name: 'Award to EMV Africa' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Say why')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Award and raise order' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/rfqs/r-1/award', { supplierId: 's-1', reason: null }));
    // The new order, which says where it came from.
    expect(await screen.findByRole('heading', { name: 'AFRI-0042' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AFRI-02A-1325-02-02' })).toHaveAttribute('href', '/rfqs/r-1');
    expect(await screen.findByText('Purchase order raised from AFRI-02A-1325-02-02')).toBeInTheDocument();
  });

  it('asks why before awarding a dearer quote, one that ran out, or one with a line not offered', async () => {
    appAt('/rfqs/r-1');
    fireEvent.click(within(await comparison()).getByRole('button', { name: 'Award to Macsteel' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('EMV Africa quoted less for every line: ZAR 690.00 against 736.00');
    expect(dialog).toHaveTextContent("Macsteel's quote ran out on 2026-01-31");
    const confirm = within(dialog).getByRole('button', { name: 'Award and raise order' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Only one with stock' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/rfqs/r-1/award', { supplierId: 's-2', reason: 'Only one with stock' }));
  });

  it('asks why for a quote that left a line unpriced', async () => {
    appAt('/rfqs/r-1');
    fireEvent.click(within(await comparison()).getByRole('button', { name: 'Award to Hydac' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent("Hydac didn't price 1 line: the order has it without a price");
  });

  it('shows an awarded RFQ’s order, with no more awarding', async () => {
    current = AWARDED;
    appAt('/rfqs/r-1');
    expect(await screen.findByText('Awarded to EMV Africa')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'AFRI-0042' })[0]).toHaveAttribute('href', '/purchase-orders/po-9');
    expect(within(await comparison()).queryByRole('button', { name: /Award to/ })).not.toBeInTheDocument();
  });

  it('offers no award to someone who may not raise orders', async () => {
    auth.roles = ['STORE_CONTROLLER'];
    appAt('/rfqs/r-1');
    expect(within(await comparison()).queryByRole('button', { name: /Award to/ })).not.toBeInTheDocument();
  });
});
