import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));

const { StockStatus } = await import('./StockStatus');

const row = (sku: string, name: string, status: string, onHand: string, required: string, percent: number | null, reorder: string, where = 'A-1') => ({
  materialId: `m-${sku}`, sku, name, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: required, onHand,
  percentOfRequired: percent, status, reorderQuantity: reorder, unitCost: '10',
  locations: Number(onHand) > 0 ? [{ locationId: 'l-1', locationName: where, quantity: onHand }] : [],
});

const ROWS = [
  row('DISC', 'Grinding disc', 'URGENT', '11', '100', 11, '89'),
  row('FLAP', 'Flap disc', 'WARNING', '10', '50', 20, '40', 'Stores'),
  row('CUT', 'Cutting disc', 'OK', '167', '100', 167, '0'),
  row('SLUG', 'Slugs 14mm', 'NOT_SET', '6', '0', null, '0'),
];

describe('StockStatus page', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(ROWS);
  });

  function renderPage() {
    render(<MemoryRouter><StockStatus /></MemoryRouter>);
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
    fireEvent.change(screen.getByLabelText('Search stock status'), { target: { value: 'stores' } });
    expect(screen.getByText('Flap disc')).toBeInTheDocument();
    expect(screen.queryByText('Grinding disc')).not.toBeInTheDocument();
  });
});
