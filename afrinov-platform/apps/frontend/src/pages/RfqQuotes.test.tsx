// Recording the quotes that come back (RFQ roadmap, Phase 4): each supplier's
// prices typed in from their quotation, with live totals, their own PDF
// attached, or their decline, all from the RFQ's page while it is sent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPut, mockDel, mockUpload, mockDownloadFile, auth } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPut: vi.fn(), mockDel: vi.fn(), mockUpload: vi.fn(), mockDownloadFile: vi.fn(),
  auth: { roles: ['PROCUREMENT'] as string[] },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), put: mockPut, del: mockDel },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../api/rfqQuoteFile', async (original) => ({
  ...(await original<typeof import('../api/rfqQuoteFile')>()), uploadQuoteFile: mockUpload, downloadQuoteFile: mockDownloadFile,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Buyer', roles: auth.roles } }) }));

const { RfqDetail } = await import('./RfqDetail');
const { ToastProvider } = await import('../components/Toast');
const { todayInSouthAfrica } = await import('../lib/rfq');

const supplier = (id: string, name: string, currency = 'ZAR') => ({ id, name, active: true, currency });
const lines = [
  { id: 'l-1', lineNo: 1, materialId: 'm-1', quantity: '4', material: { sku: 'WHEEL-SS', name: 'Overhead rail wheel', unitOfMeasure: 'LOTS' } },
  { id: 'l-2', lineNo: 2, materialId: 'm-2', quantity: '2.5', material: { sku: 'PIN-C', name: 'Clevis pin', unitOfMeasure: 'PC' } },
];
const QUOTED = {
  supplierId: 's-1', supplier: supplier('s-1', 'EMV Africa'), declined: false, quotedAt: '2026-10-29T00:00:00.000Z', quoteReference: 'Q-2291',
  validUntil: '2026-11-30T00:00:00.000Z', leadTime: '2 weeks', notes: null, vatRate: 15,
  prices: [{ rfqLineId: 'l-1', unitPrice: '160' }], totals: { subtotal: '640.00', vat: '96.00', net: '736.00', unpricedLines: 1 },
  quoteFile: { fileName: 'EMV quote 1094.pdf', size: 52_000, uploadedAt: '2026-10-29T08:00:00Z' },
};
const AWAITING = { supplierId: 's-2', supplier: supplier('s-2', 'Macsteel'), declined: false, quotedAt: null, vatRate: 15, prices: [], totals: null, quoteFile: null };
const FOREIGN = { supplierId: 's-3', supplier: supplier('s-3', 'Hydac GmbH', 'EUR'), declined: false, quotedAt: null, vatRate: 0, prices: [], totals: null, quoteFile: null };
const rfq = (status: string) => ({
  id: 'r-1', number: 'AFRI-02A-1325-02-02', status, closed: false, projectNumber: 'AFRI-1325', description: 'Door rails', notes: null,
  penaltiesApply: false, issuedAt: '2026-10-28T00:00:00.000Z', closingDate: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-28T08:00:00Z',
  lines, suppliers: [QUOTED, AWAITING, FOREIGN],
});
let current = rfq('SENT');

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  current = rfq('SENT');
  mockGet.mockReset().mockImplementation(async (path: string) => (path === '/rfqs/r-1' ? current : []));
  mockPost.mockReset().mockResolvedValue(current);
  mockPut.mockReset().mockResolvedValue(current);
  mockDel.mockReset().mockResolvedValue(current);
  mockUpload.mockReset().mockResolvedValue(current);
  mockDownloadFile.mockReset().mockResolvedValue(undefined);
});

const page = () => render(
  <MemoryRouter initialEntries={['/rfqs/r-1']}>
    <ToastProvider><Routes><Route path="/rfqs/:id" element={<RfqDetail />} /></Routes></ToastProvider>
  </MemoryRouter>,
);
const suppliersTable = async () => screen.findByRole('table', { name: 'Suppliers asked' });

describe('Quotes on an RFQ’s page', () => {
  it('shows each answer: a quote with its total, reference and PDF, and who is still awaited', async () => {
    page();
    const table = await suppliersTable();
    const emv = within(table).getByText('EMV Africa').closest('tr')!;
    expect(within(emv).getByText('Quoted')).toBeInTheDocument();
    expect(within(emv).getByText(/736/)).toBeInTheDocument();
    expect(within(emv).getByText('1 line not offered')).toBeInTheDocument();
    expect(within(emv).getByText(/Ref Q-2291/)).toBeInTheDocument();
    fireEvent.click(within(emv).getByRole('button', { name: 'Their quotation EMV quote 1094.pdf' }));
    await waitFor(() => expect(mockDownloadFile).toHaveBeenCalledWith('r-1', 's-1', 'EMV quote 1094.pdf'));
    expect(within(within(table).getByText('Macsteel').closest('tr')!).getByText('Awaiting quote')).toBeInTheDocument();
  });

  it('records a quote with live totals, leaving a line not offered blank, and attaches their PDF', async () => {
    page();
    const table = await suppliersTable();
    fireEvent.click(within(table).getByRole('button', { name: 'Record quote for Macsteel' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Line 1 unit price'), { target: { value: '150' } });
    // 4 x 150 = 600, VAT 15% = 90, 690 in all; line 2 not offered.
    expect(within(dialog).getByLabelText('Line 1 subtotal')).toHaveTextContent('600');
    const total = within(dialog).getByLabelText('Quote total');
    expect(total).toHaveTextContent('690');
    expect(total).toHaveTextContent('1 line not offered');
    fireEvent.change(within(dialog).getByLabelText('Their quote reference'), { target: { value: 'MS-77' } });
    fireEvent.change(within(dialog).getByLabelText('Lead time'), { target: { value: 'Ex stock' } });
    const pdf = new File(['%PDF-1.4'], 'Macsteel quote.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText(/Their quotation \(PDF\)/), { target: { files: [pdf] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/rfqs/r-1/suppliers/s-2/quote', {
      quotedAt: todayInSouthAfrica(), quoteReference: 'MS-77', validUntil: null, leadTime: 'Ex stock', notes: null,
      prices: [{ rfqLineId: 'l-1', unitPrice: 150 }],
    }));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith('r-1', 's-2', pdf));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('works out a foreign supplier’s quote without VAT, in their currency', async () => {
    page();
    fireEvent.click(within(await suppliersTable()).getByRole('button', { name: 'Record quote for Hydac GmbH' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('excluding VAT, in EUR');
    fireEvent.change(within(dialog).getByLabelText('Line 2 unit price'), { target: { value: '10' } });
    const total = within(dialog).getByLabelText('Quote total');
    expect(total).toHaveTextContent('VAT 0%');
    expect(total).toHaveTextContent('25');
  });

  it('needs a price, kept to 4 decimal places, before saving a quote', async () => {
    page();
    fireEvent.click(within(await suppliersTable()).getByRole('button', { name: 'Record quote for Macsteel' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/at least one line/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Line 1 unit price'), { target: { value: '1.23456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/at most 4 decimal places/)).toBeInTheDocument();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('takes prices to 4 decimal places, and refuses a quote valid only until before it came in', async () => {
    page();
    fireEvent.click(within(await suppliersTable()).getByRole('button', { name: 'Record quote for Macsteel' }));
    const dialog = await screen.findByRole('dialog');
    // The box steps by 0.0001, as prices are kept.
    expect(within(dialog).getByLabelText('Line 1 unit price')).toHaveAttribute('step', '0.0001');
    fireEvent.change(within(dialog).getByLabelText('Line 1 unit price'), { target: { value: '12.3456' } });
    fireEvent.change(within(dialog).getByLabelText('Valid until'), { target: { value: '2020-01-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/valid only until a day before it came in/)).toBeInTheDocument();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('records that a supplier declined, with their reason', async () => {
    page();
    fireEvent.click(within(await suppliersTable()).getByRole('button', { name: 'Record quote for Macsteel' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Declined to quote'));
    expect(within(dialog).queryByLabelText('Line 1 unit price')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'No stock of 304' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/rfqs/r-1/suppliers/s-2/decline', { notes: 'No stock of 304' }));
  });

  it('edits a recorded quote from its own prices, and can take its PDF off', async () => {
    page();
    fireEvent.click(within(await suppliersTable()).getByRole('button', { name: 'Edit quote for EMV Africa' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Line 1 unit price')).toHaveValue(160);
    expect(within(dialog).getByLabelText('Their quote reference')).toHaveValue('Q-2291');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take it off' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith('/rfqs/r-1/suppliers/s-1/quote-file'));
  });

  it('keeps the dialog open with the message when the quote saves but the PDF does not', async () => {
    mockUpload.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Attach the quotation as a PDF' });
    page();
    fireEvent.click(within(await suppliersTable()).getByRole('button', { name: 'Record quote for Macsteel' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Line 1 unit price'), { target: { value: '150' } });
    fireEvent.change(within(dialog).getByLabelText(/Their quotation \(PDF\)/), { target: { files: [new File(['x'], 'quote.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/Their answer is saved, but the PDF change isn't: Attach the quotation as a PDF/)).toBeInTheDocument();
  });

  it('offers no quote recording on a draft, or to someone who may not record quotes', async () => {
    current = rfq('DRAFT');
    const { unmount } = page();
    expect(within(await suppliersTable()).queryByRole('button', { name: /Record quote/ })).not.toBeInTheDocument();
    unmount();
    current = rfq('SENT');
    auth.roles = ['STORE_CONTROLLER'];
    page();
    expect(within(await suppliersTable()).queryByRole('button', { name: /Record quote|Edit quote/ })).not.toBeInTheDocument();
  });
});
