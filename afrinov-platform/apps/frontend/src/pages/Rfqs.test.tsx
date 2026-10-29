// Requests for quotation on screen (RFQ roadmap, Phase 2): the list a buyer
// lands on, the form laid out like the RFQ sheet, and an RFQ's page with Send
// (closing four days later unless changed), the closing date and suppliers
// once sent, Cancel, and its Activity in plain words.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch, mockDownload, auth } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(), mockDownload: vi.fn(), auth: { roles: ['PROCUREMENT'] as string[] },
}));
// The PDF itself is tested in rfqDocument.test.ts; here, which copy is asked for.
vi.mock('../lib/rfqDocument', async (original) => ({ ...(await original<typeof import('../lib/rfqDocument')>()), downloadRfqDocument: mockDownload }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Buyer', roles: auth.roles } }) }));

const { Rfqs } = await import('./Rfqs');
const { RfqDetail } = await import('./RfqDetail');
const { NewRfq, EditRfq } = await import('./RfqForm');
const { ToastProvider } = await import('../components/Toast');
const { addDays, todayInSouthAfrica } = await import('../lib/rfq');
const today = todayInSouthAfrica;

const supplier = (id: string, name: string) => ({ id, name, active: true, currency: 'ZAR', contactEmail: `${id}@example.co.za` });
const SUPPLIERS = [supplier('s-1', 'EMV Africa'), supplier('s-2', 'Macsteel'), supplier('s-3', 'Hydac')];
const asked = (id: string, extra: Record<string, unknown> = {}) => ({ supplierId: id, quotedAt: null, declined: false, supplier: SUPPLIERS.find((s) => s.id === id), ...extra });
const line = { id: 'l-1', lineNo: 1, materialId: 'm-1', quantity: '4.37', material: { sku: 'WHEEL-SS', name: 'Overhead rail wheel', unitOfMeasure: 'LOTS' } };
const rfq = (id: string, number: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, number, status, closed: false, projectNumber: 'AFRI-1325', project: { projectNumber: 'AFRI-1325', name: 'Door rails' },
  description: 'Door rails', notes: null, penaltiesApply: false, issuedAt: null, closingDate: null, createdAt: '2026-10-28T08:00:00Z',
  createdBy: { id: 'u-1', name: 'Buyer' }, lines: [line], suppliers: [asked('s-1'), asked('s-2')], ...extra,
});
const DRAFT = rfq('r-d', 'AFRI-02A-1325-02-01', 'DRAFT');
const SENT = rfq('r-s', 'AFRI-02A-1325-02-02', 'SENT', {
  issuedAt: '2026-10-28T00:00:00.000Z', closingDate: '2026-11-01T00:00:00.000Z', suppliers: [asked('s-1', { quotedAt: '2026-10-29T00:00:00.000Z' }), asked('s-2')],
});
const CLOSED = rfq('r-c', 'RFQ-0003', 'SENT', { projectNumber: null, project: null, description: 'Round bars', closed: true, issuedAt: '2026-10-01T00:00:00.000Z', closingDate: '2026-10-05T00:00:00.000Z' });
const AWARDED = rfq('r-a', 'RFQ-0004', 'AWARDED', { projectNumber: null, project: null });
const RFQS = [DRAFT, SENT, CLOSED, AWARDED];
let history: unknown[] = [];

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  history = [];
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/rfqs') return RFQS;
    if (path.endsWith('/history')) return history;
    const found = RFQS.find((r) => path === `/rfqs/${r.id}`);
    if (found) return found;
    if (path === '/suppliers') return SUPPLIERS;
    if (path.startsWith('/settings/values')) return { 'general.companyName': 'Afrinov', 'purchaseOrders.rfqInstructions': 'Fill in the prices.', 'purchaseOrders.rfqQuoteEmail': 'quotes@afrinov.co.za' };
    if (path === '/materials') return [
      { id: 'm-1', sku: 'WHEEL-SS', name: 'Overhead rail wheel', category: 'CONSUMABLES', unitOfMeasure: 'LOTS', requiredStock: '0', active: true },
      { id: 'm-old', sku: 'OLD-PIN', name: 'Clevis pin (old)', category: 'CONSUMABLES', unitOfMeasure: 'PC', requiredStock: '0', active: false },
    ];
    if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Door rails', status: 'ACTIVE' }];
    return [];
  });
  mockPost.mockReset().mockImplementation(async (path: string) => (path === '/rfqs' ? DRAFT : SENT));
  mockPatch.mockReset().mockResolvedValue(SENT);
  mockDownload.mockReset().mockResolvedValue(undefined);
});

const appAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <Routes>
        <Route path="/rfqs" element={<Rfqs />} />
        <Route path="/rfqs/new" element={<NewRfq />} />
        <Route path="/rfqs/:id" element={<RfqDetail />} />
        <Route path="/rfqs/:id/edit" element={<EditRfq />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

describe('Requests for quotation list', () => {
  it('opens on the drafts and the RFQs out with suppliers, showing a closed one as Closed', async () => {
    appAt('/rfqs');
    const table = await screen.findByRole('table', { name: 'Requests for quotation' });
    await within(table).findByText('AFRI-02A-1325-02-01');
    expect(within(table).getByText('AFRI-02A-1325-02-02')).toBeInTheDocument();
    expect(within(table).getByText('RFQ-0003')).toBeInTheDocument();
    expect(within(table).queryByText('RFQ-0004')).not.toBeInTheDocument();
    // One of two suppliers has quoted on the sent RFQ.
    expect(within(table).getByText('1 of 2')).toBeInTheDocument();
    expect(within(table).getByText('Closed')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '' } });
    expect(await within(table).findByText('RFQ-0004')).toBeInTheDocument();
  });

  it('offers New RFQ to buyers only', async () => {
    appAt('/rfqs');
    expect(await screen.findByRole('link', { name: /New RFQ/ })).toHaveAttribute('href', '/rfqs/new');
  });

  it.each(['APPROVER', 'STORE_CONTROLLER'])('lets a %s look, with nothing to raise, send, edit or cancel', async (role) => {
    auth.roles = [role];
    const { unmount } = appAt('/rfqs');
    await screen.findByRole('table', { name: 'Requests for quotation' });
    expect(screen.queryByRole('link', { name: /New RFQ/ })).not.toBeInTheDocument();
    unmount();
    appAt('/rfqs/r-d');
    await screen.findByRole('heading', { name: 'AFRI-02A-1325-02-01' });
    for (const name of ['Send to suppliers', 'Edit', 'Cancel RFQ']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('keeps New RFQ from someone who may not raise one', async () => {
    auth.roles = ['APPROVER'];
    appAt('/rfqs/new');
    expect(await screen.findByText(/raise requests for quotation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });
});

describe('New request for quotation', () => {
  it("saves a draft with its lines and suppliers, leaving the description to the project's name", async () => {
    appAt('/rfqs/new');
    await screen.findByRole('heading', { name: 'New request for quotation' });
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1325' } });
    fireEvent.change(await screen.findByLabelText('Line 1 item'), { target: { value: 'm-1' } });
    expect(screen.getByLabelText('Line 1 units')).toHaveTextContent('LOTS');
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '4.37' } });
    fireEvent.change(await screen.findByLabelText('Add a supplier to ask'), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('Add a supplier to ask'), { target: { value: 's-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/rfqs', expect.objectContaining({
      projectNumber: 'AFRI-1325', description: undefined, lines: [{ materialId: 'm-1', quantity: 4.37 }], supplierIds: ['s-1', 's-3'],
    })));
    await screen.findByRole('heading', { name: 'AFRI-02A-1325-02-01' });
  });

  it("doesn't offer inactive items, which the server would refuse", async () => {
    appAt('/rfqs/new');
    const select = await screen.findByLabelText('Line 1 item');
    await within(select).findByRole('option', { name: /WHEEL-SS/ });
    expect(within(select).queryByRole('option', { name: /OLD-PIN/ })).not.toBeInTheDocument();
  });

  it('refuses a quantity finer than the 4 decimal places kept, before saving', async () => {
    appAt('/rfqs/new');
    fireEvent.change(await screen.findByLabelText('Line 1 item'), { target: { value: 'm-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '0.00001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/at most 4 decimal places/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sends Edit on a sent RFQ back to its page, where its closing date and suppliers change', async () => {
    appAt('/rfqs/r-s/edit');
    expect(await screen.findByText('Only a draft is edited here')).toBeInTheDocument();
  });
});

describe('An RFQ’s page', () => {
  it('sends a draft, closing four days from today unless changed', async () => {
    appAt('/rfqs/r-d');
    fireEvent.click(await screen.findByRole('button', { name: 'Send to suppliers' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('EMV Africa')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Closing date')).toHaveValue(addDays(today(), 4));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/rfqs/r-d/send', { closingDate: addDays(today(), 4) }));
  });

  it("won't send without a supplier to ask", async () => {
    const lonely = rfq('r-d', 'AFRI-02A-1325-02-01', 'DRAFT', { suppliers: [] });
    mockGet.mockImplementation(async (path: string) => (path === '/rfqs/r-d' ? lonely : []));
    appAt('/rfqs/r-d');
    fireEvent.click(await screen.findByRole('button', { name: 'Send to suppliers' }));
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('once sent, offers the closing date and more suppliers instead of Edit, and shows who has quoted', async () => {
    appAt('/rfqs/r-s');
    await screen.findByRole('heading', { name: 'AFRI-02A-1325-02-02' });
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    const suppliers = screen.getByRole('table', { name: 'Suppliers asked' });
    expect(within(suppliers).getByText('Quoted')).toBeInTheDocument();
    expect(within(suppliers).getByText('Awaiting quote')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Closing date & suppliers/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Closing date'), { target: { value: '2026-11-06' } });
    fireEvent.change(await within(dialog).findByLabelText('Also ask'), { target: { value: 's-3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/rfqs/r-s', { closingDate: '2026-11-06', supplierIds: ['s-1', 's-2', 's-3'] }));
  });

  it('cancels with a reason only', async () => {
    appAt('/rfqs/r-s');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel RFQ' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Cancel RFQ' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Client postponed the job' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/rfqs/r-s/cancel', { reason: 'Client postponed the job' }));
  });

  it("downloads each supplier's own copy, with the RFQ wording from Settings", async () => {
    appAt('/rfqs/r-s');
    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF for Macsteel' }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(
      expect.objectContaining({ number: 'AFRI-02A-1325-02-02' }),
      expect.objectContaining({ supplierId: 's-2' }),
      { name: 'Afrinov', instructions: 'Fill in the prices.', quoteEmail: 'quotes@afrinov.co.za' },
    ));
    expect(mockGet).toHaveBeenCalledWith('/settings/values?keys=general.companyName,purchaseOrders.rfqInstructions,purchaseOrders.rfqQuoteEmail');
  });

  it('warns when a sent RFQ is past its closing date', async () => {
    appAt('/rfqs/r-c');
    expect(await screen.findByText(/^Closed on/)).toBeInTheDocument();
  });

  it('tells its Activity in plain words, with who did each thing', async () => {
    history = [
      { id: 'h-3', action: 'UPDATE', actorId: 'u-1', actorName: 'Buyer', before: { closingDate: '2026-11-01', supplierIds: ['s-1', 's-2'] }, after: { closingDate: '2026-11-06', supplierIds: ['s-1', 's-2', 's-3'] }, createdAt: '2026-10-29T09:00:00Z' },
      { id: 'h-2', action: 'RFQ_SEND', actorId: 'u-1', actorName: 'Buyer', before: { status: 'DRAFT' }, after: { status: 'SENT', closingDate: '2026-11-01', supplierIds: ['s-1', 's-2'] }, createdAt: '2026-10-28T09:00:00Z' },
      { id: 'h-1', action: 'CREATE', actorId: null, actorName: null, before: null, after: { number: 'AFRI-02A-1325-02-02' }, createdAt: '2026-10-28T08:00:00Z' },
    ];
    appAt('/rfqs/r-s');
    expect(await screen.findByText('Sent to 2 suppliers, closing 01 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('Closing date moved to 06 Nov 2026; asked s-3')).toBeInTheDocument();
    expect(screen.getByText('Request for quotation raised as AFRI-02A-1325-02-02')).toBeInTheDocument();
  });
});
