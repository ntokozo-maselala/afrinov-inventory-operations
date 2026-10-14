import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, perms, exports } = vi.hoisted(() => ({
  mockGet: vi.fn(), perms: { activity: false },
  exports: { excel: vi.fn(), received: vi.fn(), issued: vi.fn(), counts: vi.fn(), ledger: vi.fn() },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../api/exportMovements', () => ({ downloadMovements: exports.excel, downloadMovementsPdf: exports.ledger }));
vi.mock('../api/exportReports', () => ({
  downloadReceivedStock: exports.excel, downloadIssuedStock: exports.excel, downloadStockCounts: exports.excel,
  downloadReceivedStockPdf: exports.received, downloadIssuedStockPdf: exports.issued, downloadStockCountsPdf: exports.counts,
}));
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
  useCanViewActivity: () => perms.activity,
}));

const { Movements } = await import('./Movements');
const { ToastProvider } = await import('../components/Toast');

const row = (n: number) => ({
  id: `tx-${n}`, cursor: `2026-10-05T08:00:00.000Z_tx-${String(n).padStart(4, '0')}`, postedAt: '2026-10-05T08:00:00.000Z', type: 'ISSUE',
  materialId: 'm-1', materialSku: `SKU-${n}`, materialName: 'Cutting disc', unitOfMeasure: 'each', locationId: 'l-1', locationName: 'Boiler Shop',
  quantity: '-1', actorId: 'u-1', actorName: 'Vusi',
});

const RECEIPT = {
  id: 'gr-1', cursor: 'c', number: 'GR-2026-0007', receivedAt: '2026-09-25T10:00:00.000Z', supplierName: 'Hydroscand', deliveryRef: 'INV-2041', receivedByName: 'Vusi',
  lines: [{ materialId: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', locationName: 'Main Storeroom', quantity: '20' }],
};
const SLIP = {
  id: 'iss-1', cursor: 's', issuedAt: '2026-09-25T08:00:00.000Z', recipientName: 'Sabelo', recipientType: 'WORKER', projectNumber: 'AFRI-1325', issuedByName: 'Vusi',
  lines: [
    { ...row(1), materialSku: 'DISC-115', quantity: '-3', returnedQuantity: '1', issueId: 'iss-1' },
    { ...row(2), materialSku: 'GLOVE-L', materialName: 'Welding gloves', quantity: '-2', returnedQuantity: '0', issueId: 'iss-1', reversedById: 'tx-r' },
  ],
};
const COUNTS = [
  { id: 'c-3', cursor: 'c3', at: '2026-09-25T10:00:00.000Z', locationId: 'l-1', locationName: 'Boiler Shop', countedByName: 'Vusi', counted: 2, adjusted: 1, note: null,
    differences: [{ materialId: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', quantity: '-2' }],
    lines: [
      { materialId: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', expected: '9', counted: '7', note: '2 cracked' },
      { materialId: 'm-2', sku: 'GLOVE-L', name: 'Welding gloves', unitOfMeasure: 'pair', expected: '4', counted: '4' },
    ] },
  { id: 'c-2', cursor: 'c2', at: '2026-09-25T09:00:00.000Z', locationId: 'l-1', locationName: 'Boiler Shop', countedByName: 'Vusi', counted: 4, adjusted: 1, note: null,
    differences: [{ materialId: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', quantity: '-2' }], lines: [] },
  { id: 'c-1', cursor: 'c1', at: '2026-09-25T08:00:00.000Z', locationId: 'l-1', locationName: 'Boiler Shop', countedByName: 'Vusi', counted: 3, adjusted: 0, note: null, differences: [], lines: [] },
];

function renderAt(url: string, pages: Array<Array<ReturnType<typeof row> & Record<string, unknown>>> = [[row(1)]]) {
  let page = 0;
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/inventory-transactions/summary')) return { total: 205, byType: {} };
    if (path.startsWith('/inventory-transactions/actors') || path.startsWith('/activity/actors')) return [{ id: 'u-1', name: 'Vusi' }];
    if (path.startsWith('/activity')) return [{ id: 'a-1', cursor: 'c', at: '2026-10-12T08:00:00.000Z', action: 'CREATE', entityType: 'Material', entityId: 'm-1',
      actorId: 'u-1', actorName: 'Vusi', summary: 'Added item WSHR-16 Flat washer', link: '/materials/m-1' }];
    if (path.startsWith('/stock-receipts')) return [RECEIPT];
    if (path.startsWith('/inventory-issues')) return [SLIP];
    if (path.startsWith('/stock-counts')) return COUNTS;
    if (path.startsWith('/inventory-transactions')) return pages[page++] ?? [];
    if (path.startsWith('/locations')) return [{ id: 'l-1', name: 'Boiler Shop' }];
    if (path.startsWith('/suppliers')) return [{ id: 's-1', name: 'Hydroscand' }];
    if (path.startsWith('/recipients')) return [{ id: 'r-1', name: 'Sabelo' }];
    return [];
  });
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><Movements /></ToastProvider></MemoryRouter>);
}

const calls = (prefix: string) => mockGet.mock.calls.map((c) => c[0] as string).filter((p) => p.startsWith(prefix));
const listCalls = () => calls('/inventory-transactions?');
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

describe('Movements page', () => {
  beforeEach(() => { mockGet.mockReset(); perms.activity = false; });

  it('opens on All movements for today, a single day, with no type filter', async () => {
    renderAt('/movements');
    await screen.findByText('SKU-1');
    const day = todayIso();
    expect(listCalls()[0]).toBe(`/inventory-transactions?from=${day}&to=${day}&limit=100`);
    expect(screen.getByLabelText('Report')).toHaveValue('all');
    expect(screen.getByLabelText('Date')).toHaveValue(day);
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by type')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 205 shown')).toBeInTheDocument();
  });

  it('adds an end date for a range, and goes back to a single day', async () => {
    renderAt('/movements?from=2026-09-01');
    await screen.findByText('SKU-1');
    fireEvent.click(screen.getByRole('button', { name: 'Add end date' }));
    expect(screen.getByLabelText('To')).toHaveValue('2026-09-01');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    await waitFor(() => expect(listCalls().at(-1)).toBe('/inventory-transactions?from=2026-09-01&to=2026-09-30&limit=100'));
    fireEvent.click(screen.getByRole('button', { name: 'Single day' }));
    await waitFor(() => expect(listCalls().at(-1)).toBe('/inventory-transactions?from=2026-09-01&to=2026-09-01&limit=100'));
  });

  it('sends only the filters the chosen report has', async () => {
    renderAt('/movements?report=writeoffs&from=2026-09-01&to=2026-09-30&locationId=l-1&actorId=u-1&q=disc&supplierId=s-1');
    await screen.findByText('SKU-1');
    const expected = 'from=2026-09-01&to=2026-09-30&locationId=l-1&actorId=u-1&report=writeoffs';
    expect(listCalls()[0]).toBe(`/inventory-transactions?${expected}&limit=100`);
    expect(mockGet).toHaveBeenCalledWith(`/inventory-transactions/summary?${expected}`);
    expect(screen.queryByLabelText('Supplier')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument();
  });

  it('shows issued stock as issue slips when cards are chosen, laid out like the Issue stock form, with what came back', async () => {
    renderAt('/movements?report=issued&view=cards&from=2026-09-25&recipientId=r-1&locationId=l-1&q=disc');
    const slip = await screen.findByRole('region', { name: 'Issue to Sabelo' });
    expect(within(slip).getByText('AFRI-1325')).toBeInTheDocument();
    const disc = within(slip).getByText('DISC-115').closest('tr')!;
    expect(within(disc).getByText('3')).toBeInTheDocument();
    expect(within(disc).getByText('1')).toBeInTheDocument();
    expect(within(within(slip).getByText('GLOVE-L').closest('tr')!).getByText('Reversed')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/inventory-issues?from=2026-09-25&to=2026-09-25&recipientId=r-1&locationId=l-1&q=disc&limit=50');
    expect(screen.getByLabelText('Issued to')).toHaveValue('r-1');
    expect(listCalls()).toHaveLength(0);
  });

  it('loads the next page after the last row shown, and stops when a page is short', async () => {
    const full = Array.from({ length: 100 }, (_, i) => row(i + 1));
    renderAt('/movements?from=2026-10-05', [full, [row(101)]]);
    await screen.findByText('SKU-100');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('SKU-101');
    expect(listCalls()[1]).toBe(`/inventory-transactions?from=2026-10-05&to=2026-10-05&limit=100&before=${encodeURIComponent(full[99]!.cursor)}`);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says so when the start date is after the end date, and asks for no records', async () => {
    renderAt('/movements?from=2026-10-31&to=2026-10-01');
    expect(await screen.findByText('The start date is after the end date.')).toBeInTheDocument();
    expect(listCalls()).toHaveLength(0);
  });

  it('shows received stock as deliveries when cards are chosen, laid out like the Receive stock form', async () => {
    renderAt('/movements?report=received&view=cards&from=2026-09-25&supplierId=s-1');
    const delivery = await screen.findByRole('region', { name: 'Delivery INV-2041' });
    expect(within(delivery).getByText('Hydroscand')).toBeInTheDocument();
    expect(within(delivery).getByText('Main Storeroom')).toBeInTheDocument();
    expect(within(delivery).getByText(/GR-2026-0007/)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/stock-receipts?from=2026-09-25&to=2026-09-25&supplierId=s-1&limit=50');
    expect(listCalls()).toHaveLength(0);
  });

  it('shows each count as its full sheet when cards are chosen, and older counts by their differences', async () => {
    renderAt('/movements?report=counts&view=cards&from=2026-09-25');
    const [sheet, older, clean] = await screen.findAllByRole('region', { name: 'Count at Boiler Shop' });
    const disc = within(sheet!).getByText('DISC-115').closest('tr')!;
    expect([...disc.querySelectorAll('td')].slice(1).map((td) => td.textContent)).toEqual(['9', '7 each', '-2', '2 cracked']);
    expect(within(within(sheet!).getByText('GLOVE-L').closest('tr')!).getByText('✓')).toBeInTheDocument();
    expect(within(older!).getByText('Counted before full count sheets were kept: only the differences are shown.')).toBeInTheDocument();
    expect(within(older!).getByText('-2')).toBeInTheDocument();
    expect(within(clean!).getByText('No differences: everything counted matched the system.')).toBeInTheDocument();
  });

  const cells = (tr: HTMLElement) => [...tr.querySelectorAll('td')].map((td) => td.textContent);

  it('shows received stock as a flat table by default, one row per item received', async () => {
    renderAt('/movements?report=received&from=2026-09-25&supplierId=s-1');
    const table = await screen.findByRole('table', { name: 'Received stock' });
    const disc = within(table).getByText('DISC-115').closest('tr')!;
    expect(cells(disc).slice(1)).toEqual(['Hydroscand', 'INV-2041', 'DISC-115 Cutting disc', 'Main Storeroom', '20 each', 'GR-2026-0007', 'Vusi']);
    expect(screen.getByText('1 delivery, 1 line')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Delivery INV-2041' })).not.toBeInTheDocument();
  });

  it('shows issued stock as a flat table by default, each line with its slip, and opens a line to return or reverse it', async () => {
    renderAt('/movements?report=issued&from=2026-09-25');
    const table = await screen.findByRole('table', { name: 'Issued stock' });
    const disc = within(table).getByText('DISC-115').closest('tr')!;
    expect(cells(disc).slice(1)).toEqual(['Sabelo (Worker)', 'AFRI-1325', 'DISC-115 Cutting disc', 'Boiler Shop', '3 each', '1', 'Vusi']);
    const gloves = within(table).getByText('GLOVE-L').closest('tr')!;
    expect(within(gloves).getByText('Reversed')).toBeInTheDocument();
    expect(cells(gloves)[2]).toBe('AFRI-1325');
    expect(screen.getByText(/1 issue, 2 lines/)).toBeInTheDocument();
    fireEvent.click(within(disc).getAllByRole('button')[0]!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows stock counts as a flat table by default: sheet lines, older differences, and counts with none', async () => {
    renderAt('/movements?report=counts&from=2026-09-25');
    const table = await screen.findByRole('table', { name: 'Stock counts' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(cells(rows[0]!).slice(1)).toEqual(['Boiler Shop', 'DISC-115 Cutting disc', '9', '7 each', '-2', '2 cracked', 'Vusi']);
    expect(cells(rows[1]!)[5]).toBe('✓');
    expect(cells(rows[2]!).slice(2, 6)).toEqual(['DISC-115 Cutting disc', '—', '—', '-2 each']);
    expect(cells(rows[2]!)[6]).toBe('Counted before full sheets were kept');
    expect(cells(rows[3]!)[2]).toBe('No differences: everything counted matched the system');
    expect(screen.getByText('3 counts, 4 lines')).toBeInTheDocument();
  });

  it('switches between table and cards, and keeps the choice when the report changes', async () => {
    renderAt('/movements?report=received&from=2026-09-25');
    await screen.findByRole('table', { name: 'Received stock' });
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(await screen.findByRole('region', { name: 'Delivery INV-2041' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'issued' } });
    expect(await screen.findByRole('region', { name: 'Issue to Sabelo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(await screen.findByRole('table', { name: 'Issued stock' })).toBeInTheDocument();
  });

  it('offers Other changes only to those who may see it', async () => {
    renderAt('/movements?report=other');
    await screen.findByText('SKU-1');
    expect(screen.queryByRole('option', { name: 'Other changes' })).not.toBeInTheDocument();
    expect(calls('/activity')).toHaveLength(0);
  });

  it('switches report keeping the day and dropping filters that do not apply', async () => {
    perms.activity = true;
    renderAt('/movements?from=2026-10-12&locationId=l-1');
    await screen.findByText('SKU-1');
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'other' } });
    expect(await screen.findByRole('link', { name: 'Added item WSHR-16 Flat washer' })).toHaveAttribute('href', '/materials/m-1');
    expect(mockGet).toHaveBeenCalledWith('/activity?from=2026-10-12&to=2026-10-12&limit=50');
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('downloads the chosen report as a PDF that names its dates and filters', async () => {
    for (const f of Object.values(exports)) f.mockReset().mockResolvedValue(undefined);
    renderAt('/movements?report=received&from=2026-09-25&to=2026-09-30&supplierId=s-1');
    await screen.findByText('GR-2026-0007', { exact: false });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Hydroscand' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF (.pdf)' }));
    await waitFor(() => expect(exports.received).toHaveBeenCalledWith(
      'from=2026-09-25&to=2026-09-30&supplierId=s-1',
      { title: 'Received stock, 25 Sept 2026 to 30 Sept 2026', lines: ['Supplier: Hydroscand'] },
    ));
    expect(exports.excel).not.toHaveBeenCalled();
  });

  it('downloads a ledger report as a PDF of that report, and as Excel', async () => {
    for (const f of Object.values(exports)) f.mockReset().mockResolvedValue(undefined);
    renderAt('/movements?report=writeoffs&from=2026-10-05');
    await screen.findByText('SKU-1');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF (.pdf)' }));
    await waitFor(() => expect(exports.ledger).toHaveBeenCalledWith('from=2026-10-05&to=2026-10-05', 'writeoffs', { title: 'Write-offs and adjustments, 05 Oct 2026', lines: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));
    await waitFor(() => expect(exports.excel).toHaveBeenCalledWith('from=2026-10-05&to=2026-10-05&report=writeoffs'));
  });

  it('lists tool loans, filtered by who has them, with the condition each came back in', async () => {
    const lines = [
      { ...row(1), type: 'LOAN', quantity: '-1', recipientName: 'Sabelo' },
      { ...row(2), type: 'LOAN_RETURN', quantity: '1', recipientName: 'Sabelo', reasonCode: 'DAMAGE', reasonNote: 'Chuck damaged' },
    ];
    renderAt('/movements?report=loans&from=2026-10-05&recipientId=r-1', [lines]);
    expect(await screen.findByText('Chuck damaged')).toBeInTheDocument();
    expect(listCalls()[0]).toBe('/inventory-transactions?from=2026-10-05&to=2026-10-05&recipientId=r-1&report=loans&limit=100');
    expect(screen.getByText('Checked out to', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('Tool out')).toBeInTheDocument();
    expect(screen.getByText('Damaged')).toBeInTheDocument();
  });

  it('labels each filter of the chosen report', async () => {
    renderAt('/movements');
    await screen.findByText('SKU-1');
    for (const label of ['Location', 'Person', 'Item', 'Search']) {
      expect(screen.getByText(label, { selector: 'label' })).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
