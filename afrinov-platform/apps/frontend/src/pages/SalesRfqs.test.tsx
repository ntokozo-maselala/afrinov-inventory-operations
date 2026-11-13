// Sales RFQs on screen: the list, a Sales RFQ's costing line by line with the
// actions its status and the viewer allow (Sales submits, the Director approves
// or sends back, never their own), the form's equipment lines with their labour,
// quotes, other costs and live price, and the labour rates page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch, mockQuotation, auth } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(), mockQuotation: vi.fn(),
  auth: { id: 'u-sales', roles: ['SALES'] as string[] },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, put: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: auth.id, name: 'Someone', roles: auth.roles } }) }));
// The PDF itself is built by jsPDF; here, which copy is asked for.
vi.mock('../lib/salesQuotation', async (original) => ({ ...(await original<typeof import('../lib/salesQuotation')>()), downloadQuotation: mockQuotation }));

const { SalesRfqs, SalesRfqDetail } = await import('./SalesRfqs');
const { NewSalesRfq } = await import('./SalesRfqForm');
const { LabourRates } = await import('./LabourRates');
const { ToastProvider } = await import('../components/Toast');

const RATES = [
  { id: 'lr-welder', role: 'Welder', hourlyRate: '400', active: true },
  { id: 'lr-bm', role: 'Boiler Maker', hourlyRate: '300', active: true },
  { id: 'lr-old', role: 'Retired role', hourlyRate: '100', active: false },
];
const TOTALS = {
  labour: '5650.00', material: '9000.00', other: '0.00', cost: '14650.00', markup: '5860.00', equipment: '20510.00', delivery: '500.00',
  totalExVat: '21010.00', vatRate: '15', vat: '3151.50', totalIncVat: '24161.50',
};
const RFQ = {
  id: 'r-1', number: 'AFRI-02A-1469-02-01', quoteReference: null, status: 'DRAFT', projectNumber: 'AFRI-1469',
  project: { projectNumber: 'AFRI-1469', name: 'Pump rebuild', client: 'Northam Platinum' },
  equipment: 'Main Piston Pump', description: 'Pump rebuild', notes: null, penaltiesApply: false, markupPercent: '40', deliveryPrice: '500', vatRate: null,
  clientName: 'Northam Platinum', clientAddress: 'Main Office\nFarm Zondereinde 384KQ', contactName: 'Bongi', clientReference: null,
  paymentTerms: '30 days from invoice date.', validity: '30 days from issue of quotation.', deliveryDuration: '2 - 4 weeks', deliveryTerms: 'DAP, Northam Platinum',
  signerPhone: '+27 73 805 9123', signerEmail: 'northamplats@afrinov.co.za', issuedAt: null, closingDate: null, createdAt: '2026-11-05T08:00:00.000Z',
  createdById: 'u-sales', createdBy: { id: 'u-sales', name: 'Ona Moloane' }, submittedAt: null, submittedById: null, submittedBy: null,
  approvedAt: null, approvedBy: null, returnedAt: null, returnedBy: null, returnReason: null, cancelledAt: null, cancelledBy: null, cancellationReason: null,
  equipmentLines: [{
    id: 'e-1', lineNo: 1, equipment: 'Main Piston Pump', details: null, quantity: 1,
    labour: [
      { id: 'll-1', lineNo: 1, labourRateId: 'lr-welder', role: 'Welder', hours: '10', hourlyRate: '400', total: '4000.00' },
      { id: 'll-2', lineNo: 2, labourRateId: 'lr-bm', role: 'Boiler Maker', hours: '5.5', hourlyRate: '300', total: '1650.00' },
    ],
    materials: [{
      rfqId: 'rfq-1', rfqNumber: 'AFRI-02A-1469-02-01', rfqStatus: 'SENT', description: 'Pump parts', supplierId: 's-2', supplier: 'EMV', currency: 'ZAR',
      quoteTotal: '9000.00', amount: '9000.00', unpricedLines: 0, recommendedSupplier: { id: 's-1', name: 'Local Steel' }, recommended: false, unusable: false,
    }],
    otherCosts: [],
    totals: { quantity: 1, labour: '5650.00', material: '9000.00', other: '0.00', unitCost: '14650.00', unitMarkup: '5860.00', unitPrice: '20510.00', total: '20510.00' },
  }],
  totals: TOTALS,
};
/** The pump and, as AFRI-02A-1094-04-1 has it, its installation: two fitters' days and their accommodation, for 2 sites. */
const TWO_LINES = {
  ...RFQ,
  equipmentLines: [
    RFQ.equipmentLines[0]!,
    {
      id: 'e-2', lineNo: 2, equipment: 'Installation', details: 'Accommodation & LOA\nInstallation Labour', quantity: 2,
      labour: [{ id: 'll-3', lineNo: 3, labourRateId: 'lr-welder', role: 'Welder', hours: '8', hourlyRate: '400', total: '3200.00' }],
      materials: [],
      otherCosts: [{ id: 'oc-1', lineNo: 1, description: 'Accommodation', quantity: '2', unitCost: '1200', total: '2400.00' }],
      totals: { quantity: 2, labour: '3200.00', material: '0.00', other: '2400.00', unitCost: '5600.00', unitMarkup: '2240.00', unitPrice: '7840.00', total: '15680.00' },
    },
  ],
  totals: { ...TOTALS, labour: '12050.00', other: '4800.00', cost: '25850.00', markup: '10340.00', equipment: '36190.00', totalExVat: '36690.00', vat: '5503.50', totalIncVat: '42193.50' },
};
const PENDING = { ...RFQ, status: 'PENDING_APPROVAL', submittedAt: '2026-11-06T08:00:00.000Z', submittedById: 'u-sales', submittedBy: { id: 'u-sales', name: 'Ona Moloane' }, vatRate: '15' };
const OPTIONS = [
  {
    id: 'rfq-1', number: 'AFRI-02A-1469-02-01', status: 'SENT', description: 'Pump parts', issuedAt: null, recommendedSupplierId: 's-1', salesRfqs: [],
    quotes: [
      { supplierId: 's-1', supplier: 'Local Steel', total: '9000.00', currency: 'ZAR', amount: '9000.00', unpricedLines: 0, recommended: true },
      { supplierId: 's-2', supplier: 'EMV', total: '8500.00', currency: 'ZAR', amount: '8500.00', unpricedLines: 1, recommended: false },
      { supplierId: 's-3', supplier: 'Hydac', total: '400.00', currency: 'EUR', amount: null, unpricedLines: 0, recommended: false },
    ],
  },
  { id: 'rfq-2', number: 'AFRI-02A-1469-02-03', status: 'SENT', description: 'Seals', issuedAt: null, recommendedSupplierId: null, salesRfqs: [], quotes: [] },
];

let current: Record<string, unknown> = RFQ;
function answer(path: string): unknown {
  if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1469', name: 'Pump rebuild', status: 'PLANNING', client: 'Northam Platinum' }];
  if (path.startsWith('/labour-rates')) return RATES;
  if (path.startsWith('/settings/values')) return { 'purchaseOrders.vatRate': 15, 'general.companyName': 'Afrinov' };
  if (path.startsWith('/sales-rfqs/quote-options')) return OPTIONS;
  if (path === '/sales-rfqs') return [RFQ, { ...PENDING, id: 'r-2', number: 'AFRI-02A-1469-02-02' }];
  if (path === '/sales-rfqs/r-1') return current;
  if (path === '/sales-rfqs/r-1/history') return [{ id: 'a-1', action: 'SALES_RFQ_RETURN', actorId: 'u-dir', actorName: 'Director', before: null, after: { reason: 'Too low' }, createdAt: '2026-11-06T09:00:00.000Z' }];
  throw new Error(`Unexpected GET ${path}`);
}

const renderAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <Routes>
        <Route path="/sales-rfqs" element={<SalesRfqs />} />
        <Route path="/sales-rfqs/new" element={<NewSalesRfq />} />
        <Route path="/sales-rfqs/:id" element={<SalesRfqDetail />} />
        <Route path="/labour-rates" element={<LabourRates />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  auth.id = 'u-sales';
  auth.roles = ['SALES'];
  current = RFQ;
  mockGet.mockReset().mockImplementation(async (path: string) => answer(path));
  mockPost.mockReset().mockImplementation(async () => ({ ...RFQ, id: 'r-1' }));
  mockPatch.mockReset().mockImplementation(async () => RFQ);
  mockQuotation.mockReset().mockResolvedValue(undefined);
});

describe('Sales RFQ list', () => {
  it('lists the equipment, client and total, landing Sales on what it has in hand', async () => {
    renderAt('/sales-rfqs');
    const table = await screen.findByRole('table', { name: 'Sales RFQs' });
    expect(within(table).getByRole('link', { name: 'AFRI-02A-1469-02-01' })).toHaveAttribute('href', '/sales-rfqs/r-1');
    expect(within(table).getAllByText('Main Piston Pump')).toHaveLength(2);
    expect(within(table).getAllByText(/21.010/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: /New Sales RFQ/ })).toBeInTheDocument();
  });

  it('lands the Director on what waits for their approval, with no way to raise one', async () => {
    auth.roles = ['DIRECTOR'];
    renderAt('/sales-rfqs');
    const table = await screen.findByRole('table', { name: 'Sales RFQs' });
    expect(within(table).queryByRole('link', { name: 'AFRI-02A-1469-02-01' })).not.toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'AFRI-02A-1469-02-02' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Waiting for my approval' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New Sales RFQ/ })).not.toBeInTheDocument();
  });
});

describe('Sales RFQ page', () => {
  it('shows the costing: labour, the orders, the markup and the price to the client', async () => {
    renderAt('/sales-rfqs/r-1');
    expect(await screen.findByRole('table', { name: 'Labour on line 1' })).toHaveTextContent(/Welder.*10.*400.*4.000/);
    expect(screen.getByRole('table', { name: 'Material quotes on line 1' })).toHaveTextContent(/AFRI-02A-1469-02-01.*EMV.*Procurement recommends Local Steel.*9.000/);
    // The Director sees that Sales didn't go with Procurement's recommendation.
    expect(screen.getByText(/AFRI-02A-1469-02-01: EMV chosen, Local Steel recommended/)).toBeInTheDocument();
    const price = screen.getByLabelText('Price');
    expect(price).toHaveTextContent(/Cost.*14.650/);
    expect(price).toHaveTextContent(/Markup.*40%.*5.860/);
    expect(price).toHaveTextContent(/Main Piston Pump.*20.510/);
    expect(price).toHaveTextContent(/Total incl\. VAT.*24.161,50|Total incl\. VAT.*24.161\.50/);
    expect(screen.getByText('Sent back: Too low')).toBeInTheDocument();
  });

  it('shows each equipment line with what it covers, its costs for one unit and its price times its quantity', async () => {
    current = TWO_LINES;
    renderAt('/sales-rfqs/r-1');
    const install = await screen.findByRole('region', { name: 'Equipment line 2' });
    expect(within(install).getByText('2. Installation')).toBeInTheDocument();
    expect(install).toHaveTextContent(/2 × R\s?7.840,00 = R\s?15.680,00|2 × R\s?7.840\.00 = R\s?15.680\.00/);
    expect(install).toHaveTextContent('The costs below are for one unit.');
    expect(within(install).getByRole('table', { name: 'Other costs on line 2' })).toHaveTextContent(/Accommodation.*2.*1.200.*2.400/);
    expect(within(install).getByLabelText('Price of line 2')).toHaveTextContent(/Unit price.*7.840.*Total \(2\).*15.680/);
    const price = screen.getByLabelText('Price');
    expect(price).toHaveTextContent(/Other costs.*4.800/);
    expect(price).toHaveTextContent(/2 equipment lines.*36.190/);
  });

  // AFRI-0413 Rev 2: a line the client supplies, priced at quantity 0.
  it('shows a line at quantity 0 as priced but not charged, and the notes for the quotation', async () => {
    const [pump, install] = TWO_LINES.equipmentLines;
    current = {
      ...TWO_LINES, quoteNotes: 'All Flexibles to be free issued by client',
      equipmentLines: [pump, { ...install!, quantity: 0, totals: { ...install!.totals, quantity: 0, total: '0.00' } }],
    };
    renderAt('/sales-rfqs/r-1');
    const line = await screen.findByRole('region', { name: 'Equipment line 2' });
    expect(line).toHaveTextContent(/Not charged: shown on the quotation at R\s?7.840[,.]00 a unit, R - in total/);
    expect(line).not.toHaveTextContent('The costs below are for one unit.');
    expect(within(line).getByLabelText('Price of line 2')).toHaveTextContent(/Total \(0\)\s*Not charged/);
    expect(screen.getByText('Notes on the quotation')).toBeInTheDocument();
    expect(screen.getByText('All Flexibles to be free issued by client')).toBeInTheDocument();
  });

  it("shows each line's markup, and \"by line\" beside the total markup when they differ", async () => {
    const [pump, install] = TWO_LINES.equipmentLines;
    current = {
      ...TWO_LINES, markupPercent: '40',
      equipmentLines: [
        { ...pump, markupPercent: null, totals: { ...pump!.totals, markupPercent: '40' } },
        { ...install!, markupPercent: '62', totals: { ...install!.totals, markupPercent: '62' } },
      ],
    };
    renderAt('/sales-rfqs/r-1');
    const second = await screen.findByRole('region', { name: 'Equipment line 2' });
    expect(within(second).getByLabelText('Price of line 2')).toHaveTextContent('Markup a unit (62%)');
    expect(within(screen.getByRole('region', { name: 'Equipment line 1' })).getByLabelText('Price of line 1')).toHaveTextContent('Markup a unit (40%, the job’s)');
    expect(screen.getByLabelText('Price')).toHaveTextContent(/Markup\s*by line/);
  });

  it('lets Sales submit a draft, saying what goes to the Director', async () => {
    renderAt('/sales-rfqs/r-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/21.010/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/sales-rfqs/r-1/submit'));
  });

  it('lets the Director approve or send back with a reason', async () => {
    auth.id = 'u-dir';
    auth.roles = ['DIRECTOR'];
    current = PENDING;
    renderAt('/sales-rfqs/r-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Send back' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send back' });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/What should change/), { target: { value: 'Markup too low' } });
    fireEvent.click(send);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/sales-rfqs/r-1/send-back', { reason: 'Markup too low' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it("offers no approval on one the approver raised or submitted", async () => {
    auth.id = 'u-sales';
    auth.roles = ['ADMIN'];
    current = PENDING;
    renderAt('/sales-rfqs/r-1');
    expect(await screen.findByRole('table', { name: 'Labour on line 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('shows no banner while it waits for the Director: the status says so', async () => {
    current = PENDING;
    renderAt('/sales-rfqs/r-1');
    await screen.findByRole('table', { name: 'Labour on line 1' });
    expect(screen.getAllByText('Waiting for approval').length).toBeGreaterThan(0);
    expect(screen.queryByText('Waiting for the Director')).not.toBeInTheDocument();
  });

  it('downloads the quotation once approved, and previews it before', async () => {
    current = { ...PENDING, status: 'APPROVED', quoteReference: 'AFRI-02A-1469-04-1' };
    renderAt('/sales-rfqs/r-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Download quotation' }));
    await waitFor(() => expect(mockQuotation).toHaveBeenCalledWith(expect.objectContaining({ quoteReference: 'AFRI-02A-1469-04-1' }), expect.objectContaining({ name: 'Afrinov' })));
    expect(mockGet).toHaveBeenCalledWith('/settings/values?keys=general.companyName,purchaseOrders.quotationNotes,purchaseOrders.quotationLetterhead');
  });
});

describe('Sales RFQ form', () => {
  it('prices labour and the chosen quotes as it is typed, starting on the recommended one, and saves them', async () => {
    renderAt('/sales-rfqs/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1469' } });
    // The project's client fills in the client.
    expect(screen.getByLabelText('Client')).toHaveValue('Northam Platinum');
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: 'Main Piston Pump' } });
    await screen.findByRole('option', { name: 'Welder' });
    fireEvent.change(screen.getByLabelText('Labour line 1 role'), { target: { value: 'lr-welder' } });
    fireEvent.change(screen.getByLabelText('Labour line 1 hours'), { target: { value: '10' } });
    expect(screen.getByLabelText('Labour line 1 total')).toHaveTextContent(/4.000/);
    fireEvent.click(await screen.findByLabelText(/AFRI-02A-1469-02-01/));
    // It starts on the quote Procurement recommends; one that can't be valued in rand can't be chosen.
    expect(screen.getByLabelText('Local Steel on AFRI-02A-1469-02-01')).toBeChecked();
    expect(screen.getByLabelText('Hydac on AFRI-02A-1469-02-01')).toBeDisabled();
    expect(screen.getByText('1 line not priced')).toBeInTheDocument();
    // An RFQ with no quotes yet can't be counted.
    expect(screen.getByLabelText(/AFRI-02A-1469-02-03/)).toBeDisabled();
    expect(screen.queryByRole('option', { name: /Retired role/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Job markup %'), { target: { value: '40' } });
    const preview = screen.getByLabelText('Price as typed');
    expect(preview).toHaveTextContent(/Cost.*13.000/);
    expect(preview).toHaveTextContent(/Main Piston Pump.*18.200/);
    // Sales can go with another supplier's quote.
    fireEvent.click(screen.getByLabelText('EMV on AFRI-02A-1469-02-01'));
    expect(preview).toHaveTextContent(/Cost.*12.500/);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/sales-rfqs', expect.objectContaining({
      projectNumber: 'AFRI-1469', clientName: 'Northam Platinum', markupPercent: 40, deliveryPrice: 0,
      equipmentLines: [{
        equipment: 'Main Piston Pump', details: null, quantity: 1, markupPercent: null,
        labour: [{ labourRateId: 'lr-welder', hours: 10 }], materials: [{ rfqId: 'rfq-1', supplierId: 's-2' }], otherCosts: [],
      }],
    })));
    // Left blank on a new one, the server fills in the usual conditions.
    expect(mockPost.mock.calls[0]![1]).not.toHaveProperty('paymentTerms');
  });

  it('adds another equipment line, priced the same way, with its own quantity and other costs; a quote counts on one line only', async () => {
    renderAt('/sales-rfqs/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1469' } });
    await screen.findByRole('option', { name: 'Welder' });
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: 'Main Piston Pump' } });
    fireEvent.click(await screen.findByLabelText(/AFRI-02A-1469-02-01/));
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment line' }));

    const second = screen.getByRole('group', { name: 'Equipment line 2' });
    fireEvent.change(within(second).getByLabelText('Equipment'), { target: { value: 'Installation' } });
    fireEvent.change(within(second).getByLabelText('What it covers'), { target: { value: 'Accommodation & LOA\nInstallation Labour' } });
    fireEvent.change(within(second).getByLabelText('Qty'), { target: { value: '2' } });
    expect(second).toHaveTextContent(/for one unit; the line.s price is that times 2/);
    fireEvent.change(within(second).getByLabelText('Line 2 labour 1 role'), { target: { value: 'lr-welder' } });
    fireEvent.change(within(second).getByLabelText('Line 2 labour 1 hours'), { target: { value: '8' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Add other cost to equipment line 2' }));
    fireEvent.change(within(second).getByLabelText('Line 2 other cost 1 description'), { target: { value: 'Accommodation' } });
    fireEvent.change(within(second).getByLabelText('Line 2 other cost 1 quantity'), { target: { value: '2' } });
    fireEvent.change(within(second).getByLabelText('Line 2 other cost 1 unit cost'), { target: { value: '1200' } });
    expect(within(second).getByLabelText('Line 2 other cost 1 total')).toHaveTextContent(/2.400/);
    // The RFQ already counted on line 1 can't be counted again here.
    const rfqOnSecond = within(second).getByLabelText(/AFRI-02A-1469-02-01/);
    expect(rfqOnSecond).toBeDisabled();
    expect(within(second).getByText('Counted on equipment line 1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Job markup %'), { target: { value: '40' } });
    // 3 200 + 2 400 = 5 600 a unit, × 1.4 = 7 840, × 2 = 15 680; the pump 9 000 × 1.4 = 12 600.
    expect(within(second).getByLabelText('Price of equipment line 2')).toHaveTextContent(/Unit price.*7.840.*Total.*15.680/);
    const preview = screen.getByLabelText('Price as typed');
    expect(preview).toHaveTextContent(/2\. Installation × 2.*15.680/);
    expect(preview).toHaveTextContent(/Equipment lines.*28.280/);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect((mockPost.mock.calls[0]![1] as { equipmentLines: unknown[] }).equipmentLines).toEqual([
      { equipment: 'Main Piston Pump', details: null, quantity: 1, markupPercent: null, labour: [], materials: [{ rfqId: 'rfq-1', supplierId: 's-1' }], otherCosts: [] },
      {
        equipment: 'Installation', details: 'Accommodation & LOA\nInstallation Labour', quantity: 2, markupPercent: null,
        labour: [{ labourRateId: 'lr-welder', hours: 8 }], materials: [], otherCosts: [{ description: 'Accommodation', quantity: 2, unitCost: 1200 }],
      },
    ]);
  });

  // AFRI-0413's costing sheet marks its spares up 62% where the job is at 56%.
  it("gives a line its own markup, the job's being for the rest, and saves it", async () => {
    renderAt('/sales-rfqs/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1469' } });
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: 'Maintenance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add other cost to the equipment line' }));
    fireEvent.change(screen.getByLabelText('Other cost 1 description'), { target: { value: 'Labour and costs' } });
    fireEvent.change(screen.getByLabelText('Other cost 1 unit cost'), { target: { value: '255600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment line' }));
    const second = screen.getByRole('group', { name: 'Equipment line 2' });
    fireEvent.change(within(second).getByLabelText('Equipment'), { target: { value: 'Anticipated Spares' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Add other cost to equipment line 2' }));
    fireEvent.change(within(second).getByLabelText('Line 2 other cost 1 description'), { target: { value: 'Spares allowance' } });
    fireEvent.change(within(second).getByLabelText('Line 2 other cost 1 unit cost'), { target: { value: '45000' } });

    fireEvent.change(screen.getByLabelText('Job markup %'), { target: { value: '56' } });
    // A line left blank takes the job's, and says so.
    expect(within(screen.getByRole('group', { name: 'Equipment line 1' })).getByText("Blank: the job's 56%.")).toBeInTheDocument();
    fireEvent.change(within(second).getByLabelText('Markup %'), { target: { value: '62' } });
    expect(within(second).getByLabelText('Price of equipment line 2')).toHaveTextContent(/Unit price.*72.900/);
    expect(screen.getByLabelText('Price as typed')).toHaveTextContent(/Total excl. VAT.*471.636,00/);

    // A line's markup is checked like the job's, naming the line.
    fireEvent.change(within(second).getByLabelText('Markup %'), { target: { value: '6.255' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Equipment line 2: its markup is a percentage from 0 to 1000, to at most 2 decimal places.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();

    fireEvent.change(within(second).getByLabelText('Markup %'), { target: { value: '62' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const body = mockPost.mock.calls[0]![1] as { markupPercent: number; equipmentLines: Array<{ markupPercent: number | null }> };
    expect(body.markupPercent).toBe(56);
    expect(body.equipmentLines.map((l) => l.markupPercent)).toEqual([null, 62]);
  });

  it('refuses a quantity that is not a whole number, naming the line', async () => {
    renderAt('/sales-rfqs/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1469' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment line' }));
    fireEvent.change(within(screen.getByRole('group', { name: 'Equipment line 2' })).getByLabelText('Qty'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Equipment line 2: the quantity is a whole number, 0 or more (0 prices it without charging it).')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  // AFRI-0413 Rev 2: the flexibles the client supplies are priced at quantity 0,
  // and the quotation adds "All Flexibles to be free issued by client".
  it('prices a line at quantity 0 without charging it, and saves the notes for the quotation', async () => {
    renderAt('/sales-rfqs/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1469' } });
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: 'Maintenance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add other cost to the equipment line' }));
    fireEvent.change(screen.getByLabelText('Other cost 1 description'), { target: { value: 'Oil testing' } });
    fireEvent.change(screen.getByLabelText('Other cost 1 unit cost'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment line' }));

    const second = screen.getByRole('group', { name: 'Equipment line 2' });
    fireEvent.change(within(second).getByLabelText('Equipment'), { target: { value: 'Electrode Flexibles' } });
    fireEvent.change(within(second).getByLabelText('Qty'), { target: { value: '0' } });
    expect(second).toHaveTextContent(/Priced for the client to see, not charged/);
    fireEvent.click(within(second).getByRole('button', { name: 'Add other cost to equipment line 2' }));
    fireEvent.change(within(second).getByLabelText('Line 2 other cost 1 description'), { target: { value: 'Flexibles' } });
    fireEvent.change(within(second).getByLabelText('Line 2 other cost 1 unit cost'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Job markup %'), { target: { value: '50' } });

    // Its unit price shows; only line 1 is charged: 1 000 × 1.5 = 1 500.
    expect(within(second).getByLabelText('Price of equipment line 2')).toHaveTextContent(/Unit price.*750.*Total.*0,00/);
    const preview = screen.getByLabelText('Price as typed');
    expect(preview).toHaveTextContent(/2\. Electrode Flexibles \(not charged\)/);
    expect(preview).toHaveTextContent(/Total excl. VAT.*1.500,00/);

    fireEvent.change(screen.getByLabelText('Notes on the quotation'), { target: { value: 'All Flexibles to be free issued by client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const body = mockPost.mock.calls[0]![1] as { quoteNotes: string; equipmentLines: Array<{ quantity: number }> };
    expect(body.quoteNotes).toBe('All Flexibles to be free issued by client');
    expect(body.equipmentLines.map((l) => l.quantity)).toEqual([1, 0]);
  });

  it('refuses hours finer than 2 decimal places and a role with no hours before saving', async () => {
    renderAt('/sales-rfqs/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1469' } });
    await screen.findByRole('option', { name: 'Welder' });
    fireEvent.change(screen.getByLabelText('Labour line 1 role'), { target: { value: 'lr-welder' } });
    fireEvent.change(screen.getByLabelText('Labour line 1 hours'), { target: { value: '1,555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Labour line 1 needs a role and its hours/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('is not for a senior manager', async () => {
    auth.roles = ['DIRECTOR'];
    renderAt('/sales-rfqs/new');
    expect(await screen.findByText(/cannot raise Sales RFQs/i)).toBeInTheDocument();
  });
});

describe('Labour rates', () => {
  it('lets the Workshop Manager change a rate, and hides inactive roles until asked', async () => {
    auth.roles = ['WORKSHOP_MANAGER'];
    renderAt('/labour-rates');
    const table = await screen.findByRole('table', { name: 'Labour rates' });
    expect(within(table).queryByText('Retired role')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show inactive roles'));
    expect(within(table).getByText('Retired role')).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Change Welder' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Selling rate per hour/), { target: { value: '450' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/labour-rates/lr-welder', { role: 'Welder', hourlyRate: 450, active: true }));
  });

  it('shows Sales the rates without letting it change them', async () => {
    renderAt('/labour-rates');
    await screen.findByRole('table', { name: 'Labour rates' });
    expect(screen.queryByRole('button', { name: /Change|Add role/ })).not.toBeInTheDocument();
  });
});
