import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { mockGet, mockDownload } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../api/exportProcurementSavings', () => ({ downloadProcurementSavings: mockDownload }));

const { ProcurementSavings } = await import('./ProcurementSavings');
const { ToastProvider } = await import('../components/Toast');

const price = (supplier: string, lineTotal: string, currency = 'ZAR') => ({ supplier, currency, unitPrice: '1', lineTotal });
const ROW = {
  rfqId: 'r-1', rfqNumber: 'AFRI-02A-1404-02-02', rfqStatus: 'AWARDED', projectNumber: 'AFRI-1404', projectName: 'Pipe spools', lineNo: 1,
  sku: 'PIPE', material: 'Pipe', unitOfMeasure: 'each', quantity: '24',
  sales: { rfqNumber: 'AFRI-02A-1404-02-01', lineNo: 1, description: '200NB pipes x 3m', unitOfMeasure: 'each', quantity: '24', cancelled: false, prices: [price('Fasteners', '2160.00'), price('Local Steel', '2400.00')], lowest: '2160.00' },
  procurement: { prices: [price('EMV', '2280.00'), price('Macsteel', '2112.00')], lowest: '2112.00' },
  order: { number: 'PO-1', status: 'APPROVED', supplier: 'EMV', currency: 'ZAR', quantity: '24', unitPrice: '95', lineTotal: '2280.00', discountPercent: '10', discount: '228.00' },
  salesVsProcurement: '48.00', procurementVsOrder: '-168.00', salesVsOrder: '-120.00', notes: [],
};
const UNLINKED = { ...ROW, rfqId: 'r-2', rfqNumber: 'AFRI-02A-1404-02-03', sales: null, order: null, salesVsProcurement: null, procurementVsOrder: null, salesVsOrder: null, notes: ['Not linked to a Sales line'] };
const REPORT = {
  from: '2026-11-01', to: '2026-11-30', currency: 'ZAR', rows: [ROW, UNLINKED],
  total: { sales: '2160.00', procurement: '4224.00', order: '2280.00', discount: '228.00', salesVsProcurement: '48.00', procurementVsOrder: '-168.00', salesVsOrder: '-120.00', lines: 2, linked: 1 },
};

const lastReportCall = () => mockGet.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/reports/procurement-savings')).pop()!;
function Address() {
  return <output data-testid="address">{useLocation().search}</output>;
}
const renderPage = (url = '/reports/procurement-savings?from=2026-11-01&to=2026-11-30') => render(
  <MemoryRouter initialEntries={[url]}><ToastProvider><ProcurementSavings /><Address /></ToastProvider></MemoryRouter>,
);

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/projects') ? [{ projectNumber: 'AFRI-1404', name: 'Pipe spools' }] : REPORT));
  mockDownload.mockReset().mockResolvedValue(undefined);
});

describe('Procurement savings page', () => {
  it('shows each supplier on both sides, the order, the discount and the differences', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Procurement savings' });
    const row = within(table).getByRole('link', { name: 'AFRI-02A-1404-02-02' }).closest('tr')!;
    expect(within(row).getByText(/Fasteners/)).toBeInTheDocument();
    expect(within(row).getByText(/Local Steel/)).toBeInTheDocument();
    expect(within(row).getByText(/Macsteel/)).toBeInTheDocument();
    expect(within(row).getByText('Sales: 200NB pipes x 3m')).toBeInTheDocument();
    expect(within(row).getByText(/228/)).toBeInTheDocument();
    expect(within(row).getByText(/-.*168|168.*-/)).toHaveClass('text-danger-700');
  });

  it('marks the lowest rand price on each side', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Procurement savings' });
    const row = within(table).getByRole('link', { name: 'AFRI-02A-1404-02-02' }).closest('tr')!;
    expect(within(row).getByText(/Macsteel/).closest('li')).toHaveClass('font-semibold');
    expect(within(row).getAllByText(/EMV/).find((e) => e.tagName === 'LI')).not.toHaveClass('font-semibold');
  });

  it('keeps an unlinked line, saying so', async () => {
    renderPage();
    expect(await screen.findByText('Not linked to a Sales line')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AFRI-02A-1404-02-03' })).toHaveAttribute('href', '/rfqs/r-2');
  });

  it('adds a total row from the server\'s totals', async () => {
    renderPage();
    const total = (await screen.findByText(/Total \(2 lines, 1 linked to Sales\)/)).closest('tr')!;
    expect(within(total).getByText(/4.224/)).toBeInTheDocument();
    expect(within(total).getByText(/-.*120|120.*-/)).toHaveClass('text-danger-700');
  });

  it('shows what it comes to above the table, without scrolling across to it', async () => {
    renderPage();
    const totals = await screen.findByLabelText('Totals');
    expect(within(totals).getByText('Sales vs Procurement').parentElement).toHaveTextContent(/48/);
    expect(within(totals).getByText('Sales vs PO').parentElement).toHaveTextContent(/120/);
    expect(within(totals).getByText('Line discounts').parentElement).toHaveTextContent(/228/);
  });

  it('asks for the period in the address, and for one project once chosen', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Procurement savings' });
    expect(lastReportCall()).toBe('/reports/procurement-savings?from=2026-11-01&to=2026-11-30');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'AFRI-1404' } });
    await waitFor(() => expect(lastReportCall()).toBe('/reports/procurement-savings?from=2026-11-01&to=2026-11-30&projectNumber=AFRI-1404'));
  });

  it('keeps the project in the address, so a reload or shared link keeps it (Qodo, PR #159)', async () => {
    renderPage();
    const select = await screen.findByLabelText('Project');
    await screen.findByRole('option', { name: /AFRI-1404/ });
    fireEvent.change(select, { target: { value: 'AFRI-1404' } });
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('?from=2026-11-01&to=2026-11-30&projectNumber=AFRI-1404'));
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/^\?from=2026-11-01&to=2026-11-30$/));
  });

  it('opens on the project in the address', async () => {
    renderPage('/reports/procurement-savings?from=2026-11-01&to=2026-11-30&projectNumber=AFRI-1404');
    await screen.findByRole('option', { name: /AFRI-1404/ });
    expect(screen.getByLabelText('Project')).toHaveValue('AFRI-1404');
    await waitFor(() => expect(lastReportCall()).toContain('projectNumber=AFRI-1404'));
  });

  it('asks nothing of the server for a period that runs backwards', async () => {
    renderPage('/reports/procurement-savings?from=2026-11-30&to=2026-11-01');
    expect(await screen.findByText('The start date is after the end date.')).toBeInTheDocument();
    expect(mockGet.mock.calls.some((c) => String(c[0]).startsWith('/reports/procurement-savings'))).toBe(false);
  });

  it('says when nothing was sent, with no total row', async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/projects') ? [] : { ...REPORT, rows: [] }));
    renderPage();
    expect(await screen.findByText('Nothing to compare')).toBeInTheDocument();
    expect(screen.queryByText(/^Total \(/)).not.toBeInTheDocument();
  });

  it('downloads the same selection as Excel, and says when that fails', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Procurement savings' });
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith('from=2026-11-01&to=2026-11-30'));
    mockDownload.mockRejectedValue(new Error('The file was empty'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download Excel' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(await screen.findByText('Download failed')).toBeInTheDocument();
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
