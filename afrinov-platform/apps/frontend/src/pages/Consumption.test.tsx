import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockDownload } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));
vi.mock('../api/exportConsumption', () => ({ downloadConsumption: mockDownload }));

const { Consumption, presetRange } = await import('./Consumption');
const { ToastProvider } = await import('../components/Toast');

const REPORT = {
  from: '2026-10-01', to: '2026-10-31', currency: 'ZAR',
  items: [
    { materialId: 'm-1', sku: 'CON-1', name: 'Grinding disc', category: 'CONSUMABLES', unitOfMeasure: 'each', issued: 30, returned: 5, used: 25, unitCost: 42.05, value: 1051.25 },
    { materialId: 'm-2', sku: 'PRJ-1', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', issued: 2.5, returned: 0, used: 2.5, unitCost: null, value: null },
  ],
  byProject: [{ projectNumber: 'AFRI-1325', projectName: 'Plant upgrade', value: 1051.25, items: 2 }, { projectNumber: null, projectName: null, value: 0, items: 1 }],
  byCategory: [{ category: 'CONSUMABLES', value: 1051.25, items: 1 }],
  total: { value: 1051.25, items: 2, unpriced: 1 },
};

function renderPage() {
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade' }];
    return REPORT;
  });
  render(<MemoryRouter><ToastProvider><Consumption /></ToastProvider></MemoryRouter>);
}

const lastReportCall = () => mockGet.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/reports/consumption')).pop()!;

describe('Consumption page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDownload.mockReset().mockResolvedValue(undefined);
  });

  it('works out the preset periods in the local calendar', () => {
    const today = new Date(2026, 9, 9);
    expect(presetRange('this-month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('last-month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('this-year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(presetRange('last-12', today)).toEqual({ from: '2025-11-01', to: '2026-10-31' });
    expect(presetRange('last-month', new Date(2026, 0, 15))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
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
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-31' } });
    await waitFor(() => expect(lastReportCall()).toBe('/reports/consumption?from=2026-03-01&to=2026-03-31'));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-01' } });
    expect(screen.getByText('The start date is after the end date.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download as Excel' })).toBeDisabled();
  });

  it('downloads the same selection as Excel', async () => {
    renderPage();
    await screen.findByText('Pipe');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'CONSUMABLES' } });
    await waitFor(() => expect(lastReportCall()).toContain('category=CONSUMABLES'));
    fireEvent.click(screen.getByRole('button', { name: 'Download as Excel' }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(expect.stringContaining('category=CONSUMABLES')));
  });
});
