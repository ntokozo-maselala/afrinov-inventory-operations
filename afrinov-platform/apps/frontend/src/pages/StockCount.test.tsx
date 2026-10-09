import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

const { StockCount } = await import('./StockCount');
const { ToastProvider } = await import('../components/Toast');

let stockAtA1 = [
  { materialId: 'm-1', materialSku: 'DISC-115', materialName: 'Cutting disc', unitOfMeasure: 'each', quantity: '10' },
  { materialId: 'm-2', materialSku: 'GLOVE-L', materialName: 'Welding gloves', unitOfMeasure: 'pair', quantity: '4' },
  { materialId: 'm-3', materialSku: 'TAPE', materialName: 'Insulation tape', unitOfMeasure: 'roll', quantity: '2' },
];

function renderPage() {
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/locations')) return [{ id: 'l-1', name: 'A-1', active: true }, { id: 'l-old', name: 'Closed', active: false }];
    if (path.startsWith('/materials')) return [
      { id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', active: true },
      { id: 'm-9', sku: 'BOLT-M12', name: 'M12 bolt', unitOfMeasure: 'each', active: true },
    ];
    if (path.startsWith('/reports/current-stock?locationId=l-1')) return stockAtA1;
    return [];
  });
  render(<MemoryRouter><ToastProvider><StockCount /></ToastProvider></MemoryRouter>);
}

async function chooseA1() {
  await waitFor(() => expect(screen.getByRole('option', { name: 'A-1' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/Location/), { target: { value: 'l-1' } });
  await screen.findByText('Cutting disc');
}

const count = (name: string, value: string) => fireEvent.change(screen.getByLabelText(`Counted ${name}`), { target: { value } });

describe('StockCount page', () => {
  beforeEach(() => {
    localStorage.clear();
    stockAtA1 = stockAtA1.map((r) => ({ ...r }));
    mockGet.mockReset();
    mockPost.mockReset().mockResolvedValue({ countId: 'c-1', counted: 2, adjusted: 1, lines: [] });
  });

  it('lists what the system has at the location and shows each difference', async () => {
    renderPage();
    await chooseA1();
    expect(screen.queryByRole('option', { name: 'Closed' })).not.toBeInTheDocument();
    count('Cutting disc', '7');
    count('Welding gloves', '4');
    const disc = screen.getByText('Cutting disc').closest('tr')!;
    expect(within(disc).getByText('-3')).toBeInTheDocument();
    expect(within(screen.getByText('Welding gloves').closest('tr')!).getByText('✓')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 counted · 1 difference')).toBeInTheDocument();
  });

  it('asks before posting, then sends only the counted items with the quantities shown', async () => {
    renderPage();
    await chooseA1();
    count('Cutting disc', '7,5');
    count('Welding gloves', '4');
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: ' Rack A recount ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    expect(screen.getByText(/1 adjustment will be posted at A-1: 0 up, 1 down/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/stock-counts', {
      locationId: 'l-1',
      note: 'Rack A recount',
      lines: [
        { materialId: 'm-1', expectedQuantity: 10, countedQuantity: 7.5 },
        { materialId: 'm-2', expectedQuantity: 4, countedQuantity: 4 },
      ],
    }));
    expect(await screen.findByText('Count posted at A-1: 1 adjustment')).toBeInTheDocument();
    expect(screen.getByLabelText('Counted Cutting disc')).toHaveValue('');
  });

  it('adds an item found that is not listed, with nothing on the system', async () => {
    renderPage();
    await chooseA1();
    const add = screen.getByLabelText(/Found an item/);
    fireEvent.focus(add);
    fireEvent.change(add, { target: { value: 'bolt' } });
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getByRole('option', { name: /M12 bolt/ }));
    count('M12 bolt', '25');
    expect(within(screen.getByText('M12 bolt').closest('tr')!).getByText('+25')).toBeInTheDocument();
  });

  it('refuses nothing counted or a count that is not a number, without posting', async () => {
    renderPage();
    await chooseA1();
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    expect(screen.getByText('Type the counted quantity of at least one item.')).toBeInTheDocument();
    count('Insulation tape', '-1');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    expect(screen.getByText(/Check the count for TAPE/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('keeps the counts when stock moved meanwhile, and reloads the system quantities on request', async () => {
    mockPost.mockRejectedValueOnce({ code: 'CONFLICT', message: 'Stock at A-1 changed while you were counting (DISC-115: 10 → 9).' });
    renderPage();
    await chooseA1();
    count('Cutting disc', '8');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    expect(await screen.findByText(/DISC-115: 10 → 9/)).toBeInTheDocument();
    stockAtA1 = stockAtA1.map((r) => (r.materialId === 'm-1' ? { ...r, quantity: '9' } : r));
    fireEvent.click(screen.getByRole('button', { name: 'Reload system quantities' }));
    await waitFor(() => expect(within(screen.getByText('Cutting disc').closest('tr')!).getByText('-1')).toBeInTheDocument());
    expect(screen.getByLabelText('Counted Cutting disc')).toHaveValue('8');
  });

  it('keeps a half-done count for the location in this browser', async () => {
    renderPage();
    await chooseA1();
    count('Welding gloves', '3');
    expect(JSON.parse(localStorage.getItem('stock-count-draft:l-1')!)).toMatchObject({ counts: { 'm-2': '3' } });
  });

  it('can hide the system quantities while counting', async () => {
    renderPage();
    await chooseA1();
    fireEvent.click(screen.getByLabelText(/Hide system quantities/));
    expect(screen.getByRole('columnheader', { name: 'System' })).toHaveClass('hidden');
  });
});
