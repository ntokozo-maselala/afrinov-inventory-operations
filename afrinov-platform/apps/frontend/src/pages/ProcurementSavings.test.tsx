import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { mockGet, mockDownload, pdf } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn(), pdf: { available: true } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../api/exportProcurementSavings', () => ({
  downloadProcurementSavings: mockDownload,
  get SAVINGS_PDF_AVAILABLE() { return pdf.available; },
}));

const { ProcurementSavings } = await import('./ProcurementSavings');
const { ToastProvider } = await import('../components/Toast');

const price = (supplier: string, lineTotal: string, currency = 'ZAR') => ({ supplier, currency, unitPrice: '1', lineTotal });
const ROW = {
  rfqId: 'r-1', rfqNumber: 'AFRI-02A-1404-02-02', rfqStatus: 'AWARDED', projectNumber: 'AFRI-1404', projectName: 'Pipe spools', lineNo: 1,
  sku: 'PIPE', material: 'Pipe', unitOfMeasure: 'each', quantity: '24',
  procurement: { prices: [price('EMV', '2280.00'), price('Macsteel', '2112.00')], lowest: '2112.00' },
  order: { number: 'PO-1', status: 'APPROVED', supplier: 'EMV', currency: 'ZAR', quantity: '24', unitPrice: '95', lineTotal: '2280.00', discountPercent: '10', discount: '228.00' },
  procurementVsOrder: '-168.00', notes: [],
};
const UNAWARDED = { ...ROW, rfqId: 'r-2', rfqNumber: 'AFRI-02A-1404-02-03', order: null, procurementVsOrder: null, notes: ['Not awarded yet, so there is no order to compare'] };
const REPORT = {
  from: '2026-10-01', to: '2026-10-31', currency: 'ZAR', rows: [ROW, UNAWARDED],
  total: { procurement: '4224.00', order: '2280.00', discount: '228.00', procurementVsOrder: '-168.00', lines: 2 },
};

const lastReportCall = () => mockGet.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/reports/procurement-savings')).pop()!;
function Address() {
  return <output data-testid="address">{useLocation().search}</output>;
}
const renderPage = (url = '/reports/procurement-savings?from=2026-10-01&to=2026-10-31') => render(
  <MemoryRouter initialEntries={[url]}><ToastProvider><ProcurementSavings /><Address /></ToastProvider></MemoryRouter>,
);

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/projects') ? [{ projectNumber: 'AFRI-1404', name: 'Pipe spools' }] : REPORT));
  mockDownload.mockReset().mockResolvedValue(undefined);
  pdf.available = true;
});

describe('Procurement savings page', () => {
  it('shows each supplier, the order, the discount and the difference, with no Sales column', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Procurement savings' });
    const row = within(table).getByRole('link', { name: 'AFRI-02A-1404-02-02' }).closest('tr')!;
    expect(within(row).getByText(/Macsteel/)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Sales/ })).not.toBeInTheDocument();
    expect(within(row).getByText(/228/)).toBeInTheDocument();
    expect(within(row).getByText(/-.*168|168.*-/)).toHaveClass('text-danger-700');
  });

  it('marks the lowest rand price', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Procurement savings' });
    const row = within(table).getByRole('link', { name: 'AFRI-02A-1404-02-02' }).closest('tr')!;
    expect(within(row).getByText(/Macsteel/).closest('li')).toHaveClass('font-semibold');
    expect(within(row).getAllByText(/EMV/).find((e) => e.tagName === 'LI')).not.toHaveClass('font-semibold');
  });

  it('adds a total row from the server\'s totals', async () => {
    renderPage();
    const total = (await screen.findByText(/Total \(2 lines\)/)).closest('tr')!;
    expect(within(total).getByText(/4.224/)).toBeInTheDocument();
    expect(within(total).getByText(/-.*168|168.*-/)).toHaveClass('text-danger-700');
  });

  it('shows what it comes to above the table, without scrolling across to it', async () => {
    renderPage();
    const totals = await screen.findByLabelText('Totals');
    expect(within(totals).getByText('Procurement vs PO').parentElement).toHaveTextContent(/168/);
    expect(within(totals).getByText('Line discounts').parentElement).toHaveTextContent(/228/);
    expect(within(totals).queryByText(/Sales/)).not.toBeInTheDocument();
  });

  it('asks for the period in the address, and for one project once chosen', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Procurement savings' });
    expect(lastReportCall()).toBe('/reports/procurement-savings?from=2026-10-01&to=2026-10-31');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1404' } });
    await waitFor(() => expect(lastReportCall()).toBe('/reports/procurement-savings?from=2026-10-01&to=2026-10-31&projectNumber=AFRI-1404'));
  });

  it('keeps the project in the address, so a reload or shared link keeps it (Qodo, PR #159)', async () => {
    renderPage();
    const select = await screen.findByLabelText('Project');
    await screen.findByRole('option', { name: /AFRI-1404/ });
    fireEvent.change(select, { target: { value: 'AFRI-1404' } });
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('?from=2026-10-01&to=2026-10-31&projectNumber=AFRI-1404'));
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/^\?from=2026-10-01&to=2026-10-31$/));
  });

  it('opens on the project in the address', async () => {
    renderPage('/reports/procurement-savings?from=2026-10-01&to=2026-10-31&projectNumber=AFRI-1404');
    await screen.findByRole('option', { name: /AFRI-1404/ });
    expect(screen.getByLabelText('Project')).toHaveValue('AFRI-1404');
    await waitFor(() => expect(lastReportCall()).toContain('projectNumber=AFRI-1404'));
  });

  it('asks nothing of the server for a period that runs backwards', async () => {
    renderPage('/reports/procurement-savings?from=2026-10-31&to=2026-10-01');
    expect(await screen.findByText('The start date is after the end date.')).toBeInTheDocument();
    expect(mockGet.mock.calls.some((c) => String(c[0]).startsWith('/reports/procurement-savings'))).toBe(false);
  });

  it('says when nothing was sent, with no total row', async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/projects') ? [] : { ...REPORT, rows: [] }));
    renderPage();
    expect(await screen.findByText('Nothing to compare')).toBeInTheDocument();
    expect(screen.queryByText(/^Total \(/)).not.toBeInTheDocument();
  });

  /** The Download menu, as on the other reports, open. */
  const openDownloads = async () => {
    await screen.findByRole('table', { name: 'Procurement savings' });
    const button = screen.getByRole('button', { name: 'Download savings report' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
  };

  it('downloads the same selection as Excel, and says when that fails', async () => {
    renderPage();
    await openDownloads();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith('from=2026-10-01&to=2026-10-31', 'xlsx'));
    mockDownload.mockRejectedValue(new Error('The file was empty'));
    await openDownloads();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));
    expect(await screen.findByText('Download failed')).toBeInTheDocument();
  });

  it('downloads the same selection as a PDF', async () => {
    renderPage('/reports/procurement-savings?from=2026-10-01&to=2026-10-31&projectNumber=AFRI-1404');
    await openDownloads();
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF (.pdf)' }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith('from=2026-10-01&to=2026-10-31&projectNumber=AFRI-1404', 'pdf'));
  });

  it('offers Excel alone where the server can\'t make the PDF', async () => {
    pdf.available = false;
    renderPage();
    await openDownloads();
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Excel (.xlsx)']);
  });

  it('shows the error when the server refuses', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/projects')) return [];
      throw Object.assign(new Error('You do not have permission'), { code: 'FORBIDDEN' });
    });
    renderPage();
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Procurement savings' })).not.toBeInTheDocument());
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
});
