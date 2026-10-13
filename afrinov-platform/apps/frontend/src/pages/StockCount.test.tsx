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
    if (path.startsWith('/stock-counts')) return recentCounts;
    return [];
  });
  render(<MemoryRouter><ToastProvider><StockCount /></ToastProvider></MemoryRouter>);
}

async function chooseA1() {
  await waitFor(() => expect(screen.getByRole('option', { name: 'A-1' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/Location/), { target: { value: 'l-1' } });
  await screen.findByText('Cutting disc');
}

let recentCounts: Array<Record<string, unknown>> = [];

const count = (name: string, value: string) => fireEvent.change(screen.getByLabelText(`Counted ${name}`), { target: { value } });

describe('StockCount page', () => {
  beforeEach(() => {
    localStorage.clear();
    recentCounts = [];
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
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: ' Rack A recount ' } });
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

  it('flags system quantities below zero, which a count corrects', async () => {
    stockAtA1 = [...stockAtA1, { materialId: 'm-4', materialSku: 'ROD', materialName: 'Welding rod', unitOfMeasure: 'kg', quantity: '-15' }];
    renderPage();
    await chooseA1();
    expect(screen.getByText('1 item shows below zero here')).toBeInTheDocument();
    const rod = screen.getByText('Welding rod').closest('tr')!;
    expect(within(rod).getByText('Below zero: cannot be right')).toBeInTheDocument();
    count('Welding rod', '0');
    expect(within(rod).getByText('+15')).toBeInTheDocument();
  });

  it('shows the recent counts at the location, links to them all, and refreshes them after posting', async () => {
    recentCounts = [{ id: 'c-0', cursor: 'c', at: '2026-10-10T08:00:00.000Z', locationId: 'l-1', locationName: 'A-1', countedByName: 'Vusi',
      counted: 3, adjusted: 0, note: null, differences: [] }];
    renderPage();
    await chooseA1();
    expect(await screen.findByText('3 items counted, no differences')).toBeInTheDocument();
    expect(screen.getByText('by Vusi')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/stock-counts?locationId=l-1&limit=5');
    expect(screen.getByRole('link', { name: 'All counts, last 90 days' }).getAttribute('href')).toMatch(/^\/movements\?report=counts&locationId=l-1&from=/);

    const counted = () => mockGet.mock.calls.filter((c) => String(c[0]).startsWith('/stock-counts')).length;
    const before = counted();
    count('Cutting disc', '7');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(counted()).toBe(before + 1));
  });

  it('says when nothing has been counted at the location yet', async () => {
    renderPage();
    await chooseA1();
    expect(await screen.findByText('No counts recorded here yet.')).toBeInTheDocument();
  });

  it('offers a note on an item that differs, not on one that matches, and sends it with the count', async () => {
    renderPage();
    await chooseA1();
    count('Cutting disc', '7');
    count('Welding gloves', '4');
    expect(screen.queryByLabelText('Note for Welding gloves')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Note for Cutting disc'), { target: { value: ' 3 cracked, binned ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const lines = (mockPost.mock.calls[0]![1] as { lines: Array<{ materialId: string; note?: string }> }).lines;
    expect(lines.find((l) => l.materialId === 'm-1')!.note).toBe('3 cracked, binned');
    expect(lines.find((l) => l.materialId === 'm-2')).not.toHaveProperty('note');
  });

  it('drops a note when the count is corrected to match, and keeps notes in the draft', async () => {
    renderPage();
    await chooseA1();
    count('Cutting disc', '7');
    fireEvent.change(screen.getByLabelText('Note for Cutting disc'), { target: { value: 'behind rack' } });
    expect(JSON.parse(localStorage.getItem('stock-count-draft:l-1')!).notes).toEqual({ 'm-1': 'behind rack' });
    count('Cutting disc', stockAtA1.find((r) => r.materialId === 'm-1')!.quantity);
    expect(screen.queryByLabelText('Note for Cutting disc')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect((mockPost.mock.calls[0]![1] as { lines: Array<{ note?: string }> }).lines[0]).not.toHaveProperty('note');
  });

  it('counting blind, offers a note on every counted item so the box gives nothing away', async () => {
    renderPage();
    await chooseA1();
    fireEvent.click(screen.getByLabelText(/Hide system quantities/));
    count('Welding gloves', '4');
    expect(screen.getByLabelText('Note for Welding gloves')).toBeInTheDocument();
    expect(screen.queryByLabelText('Note for Cutting disc')).not.toBeInTheDocument();
  });
});
