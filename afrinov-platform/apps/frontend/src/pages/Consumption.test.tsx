import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockDownload, mockPdf } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn(), mockPdf: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));
vi.mock('../api/exportConsumption', () => ({ downloadConsumption: mockDownload, downloadConsumptionPdf: mockPdf }));

const { Consumption } = await import('./Consumption');
const { ToastProvider } = await import('../components/Toast');

const REPORT = {
  from: '2026-10-01', to: '2026-10-31', currency: 'ZAR',
  items: [
    { materialId: 'm-1', sku: 'CON-1', name: 'Grinding disc', category: 'CONSUMABLES', unitOfMeasure: 'each', issued: 30, returned: 5, used: 25, unitCost: 42.05, value: 1051.25 },
    { materialId: 'm-2', sku: 'PRJ-1', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', issued: 2.5, returned: 0, used: 2.5, unitCost: null, value: null },
  ],
  byProject: [{ projectNumber: 'AFRI-1325', projectName: 'Plant upgrade', value: 1051.25, items: 2 }, { projectNumber: null, projectName: null, value: 0, items: 1 }],
  byRecipient: [
    { recipientId: 'r-1', name: 'Sabelo', type: 'WORKER', value: 1051.25, items: 2, issues: 3 },
    { recipientId: null, name: null, type: null, value: 0, items: 1, issues: 1 },
  ],
  byCategory: [{ category: 'CONSUMABLES', value: 1051.25, items: 1 }],
  total: { value: 1051.25, items: 2, unpriced: 1 },
};

const LINES = [
  { id: 't-2', postedAt: '2026-10-03T09:30:00.000Z', type: 'RETURN', sku: 'CON-1', name: 'Grinding disc', unitOfMeasure: 'each', quantity: -5, projectNumber: 'AFRI-1325', issuedBy: 'Vusi' },
  { id: 't-1', postedAt: '2026-10-02T08:00:00.000Z', type: 'ISSUE', sku: 'CON-1', name: 'Grinding disc', unitOfMeasure: 'each', quantity: 30, projectNumber: 'AFRI-1325', issuedBy: 'Vincent' },
];

function renderPage(url = '/reports/consumption') {
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade' }];
    if (path.startsWith('/recipients')) return [{ id: 'r-1', name: 'Sabelo', type: 'WORKER', active: true }, { id: 'r-2', name: 'Khodani', type: 'WORKER', active: false }];
    if (path.includes('recipientId=')) return { ...REPORT, byRecipient: [REPORT.byRecipient[0]], lines: LINES };
    return REPORT;
  });
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><Consumption /></ToastProvider></MemoryRouter>);
}

const lastReportCall = () => mockGet.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/reports/consumption')).pop()!;

describe('Consumption page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDownload.mockReset().mockResolvedValue(undefined);
    mockPdf.mockReset().mockResolvedValue(undefined);
  });

  it('opens on this month, with From and To date boxes as on the Stock report', async () => {
    renderPage();
    await screen.findByText('Pipe');
    const now = new Date();
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    expect(screen.getByLabelText('From')).toHaveValue(first);
    expect(lastReportCall()).toMatch(new RegExp(`^/reports/consumption\\?from=${first}&to=\\d{4}-\\d{2}-\\d{2}$`));
    expect(screen.queryByLabelText('Period')).not.toBeInTheDocument();
  });

  it('labels every selector, and does not repeat the dates beside them', async () => {
    renderPage('/reports/consumption?from=2026-03-01&to=2026-03-31');
    await screen.findByText('Pipe');
    for (const label of ['From', 'To', 'Project', 'Issued to', 'Category']) {
      // A visible label, tied to its control.
      expect(screen.getByText(label, { selector: 'label' })).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('2026-03-01 to 2026-03-31')).not.toBeInTheDocument();
  });

  it('takes its period from the address, so it can be bookmarked or shared', async () => {
    renderPage('/reports/consumption?from=2026-03-01&to=2026-03-31');
    await screen.findByText('Pipe');
    expect(lastReportCall()).toBe('/reports/consumption?from=2026-03-01&to=2026-03-31');
    expect(screen.getByLabelText('To')).toHaveValue('2026-03-31');
  });

  it('shows the value used, by project and by item, for this month', async () => {
    renderPage();
    const pipe = await screen.findByText('Pipe');
    const byProject = within(screen.getByLabelText('Stock used by project'));
    expect(byProject.getByRole('button', { name: 'AFRI-1325 · Plant upgrade' })).toBeInTheDocument();
    expect(byProject.getByRole('button', { name: 'No project' })).toBeInTheDocument();
    expect(screen.getByText('1 item without a price not included')).toBeInTheDocument();
    const disc = screen.getByText('Grinding disc').closest('tr')!;
    // Item, Issued, Returned, Used, Unit price, Value.
    const cells = within(disc).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('30');
    expect(cells[2]).toHaveTextContent('5');
    expect(cells[3]).toHaveTextContent('25 each');
    expect(within(pipe.closest('tr')!).getByTitle('No unit price')).toBeInTheDocument();
    expect(lastReportCall()).toMatch(/^\/reports\/consumption\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
  });

  it('narrows to a project when its row is clicked', async () => {
    renderPage();
    await screen.findByText('Pipe');
    fireEvent.click(within(screen.getByLabelText('Stock used by project')).getByRole('button', { name: /AFRI-1325/ }));
    await waitFor(() => expect(lastReportCall()).toContain('projectNumber=AFRI-1325'));
    expect(screen.queryByLabelText('Stock used by project')).not.toBeInTheDocument();
  });

  it('takes a chosen period, and refuses one that runs backwards', async () => {
    renderPage();
    await screen.findByText('Pipe');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-31' } });
    await waitFor(() => expect(lastReportCall()).toBe('/reports/consumption?from=2026-03-01&to=2026-03-31'));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-01' } });
    expect(screen.getByText('The start date is after the end date.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('downloads the same selection as Excel, or as a PDF that says what it covers', async () => {
    renderPage();
    await screen.findByText('Pipe');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'CONSUMABLES' } });
    await waitFor(() => expect(lastReportCall()).toContain('category=CONSUMABLES'));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(expect.stringContaining('category=CONSUMABLES')));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF (.pdf)' }));
    await waitFor(() => expect(mockPdf).toHaveBeenCalledWith(expect.stringContaining('category=CONSUMABLES'), ['Category: Consumables']));
  });

  it('adds up by who it was issued to; a name opens their issue slips under Movements', async () => {
    renderPage();
    await screen.findByText('Pipe');
    const byRecipient = within(screen.getByLabelText('Stock used by recipient'));
    expect(screen.getByRole('option', { name: 'Khodani (inactive)' })).toBeInTheDocument();
    const sabelo = byRecipient.getByRole('link', { name: 'Sabelo' }).getAttribute('href')!;
    expect(sabelo).toMatch(/^\/movements\?report=issued&recipientId=r-1&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect(byRecipient.getByRole('link', { name: 'Not recorded' }).getAttribute('href')).toContain('recipientId=__none__');
    // The list of one person's issues lives in the Issued stock report, not here.
    expect(screen.queryByLabelText('Issued to Sabelo')).not.toBeInTheDocument();
  });
});
