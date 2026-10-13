import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockDownload, mockPdf, perms } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn(), mockPdf: vi.fn(), perms: { admin: false } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({ useIsAdmin: () => perms.admin }));
vi.mock('../api/exportReorderList', () => ({ downloadReorderList: mockDownload, downloadReorderListPdf: mockPdf }));

const { StockStatus } = await import('./StockStatus');
const { ToastProvider } = await import('../components/Toast');

const row = (sku: string, name: string, status: string, onHand: string, required: string, percent: number | null, reorder: string, where = 'A-1') => ({
  materialId: `m-${sku}`, sku, name, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: required, onHand,
  percentOfRequired: percent, status, reorderQuantity: reorder, unitCost: '10',
  locations: Number(onHand) > 0 ? [{ locationId: 'l-1', locationName: where, quantity: onHand }] : [],
  lastSupplier: sku === 'DISC' ? { name: 'Hydroscand', receivedAt: '2026-09-18T00:00:00.000Z' } : null,
});

const ROWS = [
  row('DISC', 'Grinding disc', 'URGENT', '11', '100', 11, '89'),
  row('FLAP', 'Flap disc', 'WARNING', '10', '50', 20, '40', 'Stores'),
  row('CUT', 'Cutting disc', 'OK', '167', '100', 167, '0'),
  row('SLUG', 'Slugs 14mm', 'NOT_SET', '6', '0', null, '0'),
];

describe('StockStatus page', () => {
  beforeEach(() => {
    perms.admin = false;
    mockGet.mockReset().mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : ROWS));
    mockDownload.mockReset().mockResolvedValue(undefined);
    mockPdf.mockReset().mockResolvedValue(undefined);
  });

  /** Open the Download menu and choose a format. */
  function downloadAs(format: 'Excel (.xlsx)' | 'PDF (.pdf)') {
    fireEvent.click(screen.getByRole('button', { name: 'Download re-order list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: format }));
  }

  function renderPage() {
    render(<MemoryRouter><ToastProvider><StockStatus /></ToastProvider></MemoryRouter>);
  }

  it('opens on the items that need re-ordering, with the percentage and re-order quantity', async () => {
    renderPage();
    expect(await screen.findByText('Grinding disc')).toBeInTheDocument();
    expect(screen.getByText('Flap disc')).toBeInTheDocument();
    expect(screen.queryByText('Cutting disc')).not.toBeInTheDocument();
    const disc = screen.getByText('Grinding disc').closest('tr')!;
    expect(within(disc).getByText('11%')).toBeInTheDocument();
    expect(within(disc).getByText('89')).toBeInTheDocument();
    expect(within(disc).getByText('Urgent')).toBeInTheDocument();
    expect(within(disc).getByText('Hydroscand')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/reports/stock-status');
  });

  it('counts items by status, and shows a status when its count is clicked', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    const counts = screen.getByLabelText('Items by status');
    fireEvent.click(within(counts).getByText('Not set').closest('button')!);
    expect(screen.getByText('Slugs 14mm')).toBeInTheDocument();
    expect(screen.queryByText('Grinding disc')).not.toBeInTheDocument();
    expect(within(screen.getByText('Slugs 14mm').closest('tr')!).getByText('Not set')).toBeInTheDocument();
  });

  it('searches by item, code or location', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'stores' } });
    expect(screen.getByText('Flap disc')).toBeInTheDocument();
    expect(screen.queryByText('Grinding disc')).not.toBeInTheDocument();
  });

  it('downloads the re-order list as Excel or PDF, and reports a failure', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    downloadAs('Excel (.xlsx)');
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(undefined));
    downloadAs('PDF (.pdf)');
    await waitFor(() => expect(mockPdf).toHaveBeenCalledWith(undefined));
    mockDownload.mockRejectedValueOnce(new Error('Request failed (500)'));
    downloadAs('Excel (.xlsx)');
    expect(await screen.findByText('Request failed (500)')).toBeInTheDocument();
  });

  it('downloads the re-order list for the chosen category, and none for a category with nothing to re-order', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'CONSUMABLES' } });
    downloadAs('PDF (.pdf)');
    await waitFor(() => expect(mockPdf).toHaveBeenCalledWith('CONSUMABLES'));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'TOOLS' } });
    expect(screen.getByRole('button', { name: 'Download re-order list' })).toBeDisabled();
  });

  it('offers no download when nothing needs re-ordering', async () => {
    mockGet.mockResolvedValue(ROWS.filter((r) => r.status === 'OK'));
    renderPage();
    await screen.findByText('Nothing needs re-ordering');
    expect(screen.getByRole('button', { name: 'Download re-order list' })).toBeDisabled();
  });

  it('shows a tool out on loan beside what is on hand', async () => {
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values') ? {} : [{ ...row('TL-1', 'Torque wrench', 'WARNING', '0', '10', 20, '8'), category: 'TOOLS', onLoan: '2' }]));
    renderPage();
    expect(await screen.findByText('+2 on loan')).toBeInTheDocument();
  });

  it('opens on the view a link asks for', async () => {
    render(<MemoryRouter initialEntries={['/reports/stock-status?view=OK']}><ToastProvider><StockStatus /></ToastProvider></MemoryRouter>);
    expect(await screen.findByText('Cutting disc')).toBeInTheDocument();
    expect(screen.queryByText('Grinding disc')).not.toBeInTheDocument();
  });

  it('says the bands as set under Settings, and links there for an admin', async () => {
    perms.admin = true;
    mockGet.mockImplementation(async (path: string) => (path.startsWith('/settings/values')
      ? { 'inventory.urgentBelowPercent': 25, 'inventory.warningBelowPercent': 50 }
      : ROWS));
    renderPage();
    expect(await screen.findByText(/urgent below 25%/)).toBeInTheDocument();
    expect(screen.getByText(/warning below 50%/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings → Inventory' })).toHaveAttribute('href', '/settings/inventory');
  });

  it('falls back to 20% and 40% when the bands cannot be read, without a link for others', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/settings/values')) throw { code: 'INTERNAL_ERROR', message: 'down' };
      return ROWS;
    });
    renderPage();
    expect(await screen.findByText(/urgent below 20%/)).toBeInTheDocument();
    expect(screen.getByText(/warning below 40%/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings → Inventory' })).not.toBeInTheDocument();
  });

  it('labels its search and filters', async () => {
    renderPage();
    await screen.findByText('Grinding disc');
    for (const label of ['Search', 'Show', 'Category']) {
      expect(screen.getByText(label, { selector: 'label' })).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
