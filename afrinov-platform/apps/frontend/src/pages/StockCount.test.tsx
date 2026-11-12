import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

// Signed in as a store controller, who may do everything on these pages; tests that need another role set signedIn.roles.
const { signedIn } = vi.hoisted(() => ({ signedIn: { roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: signedIn.roles } }) }));

const { StockCount } = await import('./StockCount');
const { ToastProvider } = await import('../components/Toast');

let stockAtA1: Array<{ materialId: string; materialSku: string; materialName: string; unitOfMeasure: string; quantity: string; heldForProject?: string }> = [
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
    // The count sheet (system audit C4-C6): one stock at the location, with or without figures.
    if (path.startsWith('/stock-counts/sheet?locationId=l-1')) {
      const of = new URLSearchParams(path.split('?')[1]).get('heldForProject');
      return {
        locationId: 'l-1', heldForProject: of, blind: sheetBlind, openedAt: OPENED_AT,
        projects: [...new Set(stockAtA1.map((r) => r.heldForProject).filter(Boolean))],
        lines: stockAtA1.filter((r) => (r.heldForProject ?? null) === of).map((r) => ({
          materialId: r.materialId, sku: r.materialSku, name: r.materialName, unitOfMeasure: r.unitOfMeasure, expected: sheetBlind ? null : r.quantity,
        })),
      };
    }
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
let sheetBlind = false;
const OPENED_AT = '2026-11-12T08:00:00.000Z';

const count = (name: string, value: string) => fireEvent.change(screen.getByLabelText(`Counted ${name}`), { target: { value } });

describe('StockCount page', () => {
  beforeEach(() => {
    localStorage.clear();
    recentCounts = [];
    sheetBlind = false;
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
    fireEvent.change(screen.getByLabelText('Note on this count (optional)'), { target: { value: ' Rack A recount ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    expect(screen.getByText(/1 adjustment will be posted at A-1: 0 up, 1 down/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/stock-counts', {
      locationId: 'l-1',
      kind: 'SPOT',
      openedAt: OPENED_AT,
      note: 'Rack A recount',
      lines: [
        { materialId: 'm-1', expectedQuantity: 10, countedQuantity: 7.5 },
        { materialId: 'm-2', expectedQuantity: 4, countedQuantity: 4 },
      ],
    }, expect.objectContaining({ idempotencyKey: expect.any(String) })));
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

  // Qodo, PR #142; system audit C6: a count is of one stock, Stores or a project's.
  it('counts one stock at a time: a project\'s stock is not on the Stores sheet, and has a sheet of its own', async () => {
    const storesOnly = stockAtA1;
    // Put back for the tests after this one, which copy it in beforeEach.
    onTestFinished(() => { stockAtA1 = storesOnly; });
    stockAtA1 = [
      ...storesOnly,
      { ...storesOnly[0]!, heldForProject: 'AFRI-1325', quantity: '50' },
      { materialId: 'm-9', materialSku: 'BOLT-M12', materialName: 'M12 bolt', unitOfMeasure: 'each', quantity: '8', heldForProject: 'AFRI-1325' },
    ] as typeof stockAtA1;
    renderPage();
    await chooseA1();
    expect(screen.getAllByText('Cutting disc')).toHaveLength(1);
    expect(screen.queryByText('M12 bolt')).not.toBeInTheDocument();
    count('Cutting disc', '7');
    expect(within(screen.getByText('Cutting disc').closest('tr')!).getByText('-3')).toBeInTheDocument();

    const add = screen.getByLabelText(/Found an item/);
    fireEvent.focus(add);
    fireEvent.change(add, { target: { value: 'bolt' } });
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getByRole('option', { name: /M12 bolt/ }));
    count('M12 bolt', '25');
    expect(within(screen.getByText('M12 bolt').closest('tr')!).getByText('+25')).toBeInTheDocument();

    // The project's own sheet: its stock, posted as its stock.
    fireEvent.change(screen.getByLabelText('Whose stock'), { target: { value: 'AFRI-1325' } });
    await waitFor(() => expect(within(screen.getByText('M12 bolt').closest('tr')!).getByText('8')).toBeInTheDocument());
    count('M12 bolt', '6');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/stock-counts', expect.objectContaining({
      heldForProject: 'AFRI-1325', lines: [{ materialId: 'm-9', expectedQuantity: 8, countedQuantity: 6 }],
    }), expect.anything()));
  });

  // System audit C5: a full count leaves nothing on the sheet blank.
  it('on a full count, asks for every item, and counts the ones not found as 0 when confirmed', async () => {
    renderPage();
    await chooseA1();
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: 'FULL' } });
    count('Cutting disc', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    expect(screen.getByText(/A full count needs every item on the sheet. 2 are blank: TAPE, GLOVE-L/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not found: count the 2 blank items as 0' }));
    expect(screen.getByLabelText('Counted Welding gloves')).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/stock-counts', expect.objectContaining({ kind: 'FULL' }), expect.anything()));
    expect(mockPost.mock.calls[0]![1].lines).toHaveLength(3);
  });

  // System audit C4: blind, the sheet has no figures and none are sent.
  it('on a blind count, shows no system figures and sends when the sheet was opened instead', async () => {
    sheetBlind = true;
    renderPage();
    await chooseA1();
    expect(screen.getByText('Blind count: system quantities are not shown')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Hide system quantities/)).not.toBeInTheDocument();
    expect(screen.queryByText('10')).not.toBeInTheDocument();
    count('Cutting disc', '7');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    expect(screen.getByText(/1 item counted at A-1. Differences from the system are worked out when it posts./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/stock-counts', expect.objectContaining({
      openedAt: OPENED_AT, lines: [{ materialId: 'm-1', countedQuantity: 7, note: undefined }].map(({ note: _n, ...l }) => l),
    }), expect.anything()));
  });

  // System audit C7: the lines that moved are counted again; the rest posted.
  it('keeps the lines held back because their stock moved, for counting again', async () => {
    mockPost.mockResolvedValueOnce({ countId: 'c-1', counted: 1, adjusted: 1, lines: [], heldBack: [{ materialId: 'm-1', sku: 'DISC-115' }] });
    renderPage();
    await chooseA1();
    count('Cutting disc', '8');
    count('Welding gloves', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    expect(await screen.findByText('1 item moved while you were counting')).toBeInTheDocument();
    expect(screen.getByText(/DISC-115 was held back: count it again and post/)).toBeInTheDocument();
    expect(screen.getByLabelText('Counted Welding gloves')).toHaveValue('');
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
      counted: 3, adjusted: 0, note: null, kind: 'FULL', heldForProject: 'AFRI-1325', differences: [] }];
    renderPage();
    await chooseA1();
    expect(await screen.findByText("Full count of AFRI-1325's stock: 3 items counted, no differences")).toBeInTheDocument();
    expect(screen.getByText('by Vusi')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/stock-counts?locationId=l-1&limit=5');
    expect(screen.getByRole('link', { name: 'All counts, last 90 days' }).getAttribute('href')).toMatch(/^\/movements\?report=counts&locationId=l-1&from=/);

    // The recent counts only, not the count sheet.
    const counted = () => mockGet.mock.calls.filter((c) => String(c[0]).startsWith('/stock-counts?')).length;
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

describe('Count stock: the location picker', () => {
  it('names a rack with the room it stands in', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/locations')) return [
        { id: 'l-1', name: 'A-1', active: true, parent: { name: 'Main Storeroom' } },
        { id: 'l-2', name: 'Boiler Shop', active: true, parent: null },
      ];
      return [];
    });
    render(<MemoryRouter><ToastProvider><StockCount /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('option', { name: 'A-1 · Main Storeroom' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Boiler Shop' })).toBeInTheDocument();
  });
});
