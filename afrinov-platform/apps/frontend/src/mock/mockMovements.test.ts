// Frontend-only Movements: the mock history must filter, page and total the
// same way the backend's historyWhere does.
import { describe, expect, it } from 'vitest';
import { createMockApi } from './mockApi';

interface Row { id: string; cursor: string; postedAt: string; type: string; locationId: string; actorId: string; materialSku: string; recipientName: string | null }

const api = createMockApi();
const day = (iso: string) => iso.slice(0, 10);

describe('mock movement history', () => {
  it('keeps a date range to whole days and includes the last one', async () => {
    const all = await api.get<Row[]>('/inventory-transactions?limit=1000');
    const target = day(all[0]!.postedAt);
    const sameDay = all.filter((t) => day(t.postedAt) === target);
    const list = await api.get<Row[]>(`/inventory-transactions?from=${target}&to=${target}&limit=1000`);
    expect(list.map((t) => t.id)).toEqual(sameDay.map((t) => t.id));
  });

  it('refuses a start after the end', async () => {
    await expect(api.get('/inventory-transactions?from=2026-10-31&to=2026-10-01')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('pages newest first without repeating or skipping a row', async () => {
    const all = await api.get<Row[]>('/inventory-transactions?limit=1000');
    const seen: string[] = [];
    let before = '';
    for (;;) {
      const page = await api.get<Row[]>(`/inventory-transactions?limit=5${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      seen.push(...page.map((t) => t.id));
      if (page.length < 5) break;
      before = page[page.length - 1]!.cursor;
    }
    expect(seen).toEqual(all.map((t) => t.id));
  });

  it('filters by location, by who posted it and by a search, and totals each type', async () => {
    const all = await api.get<Row[]>('/inventory-transactions?limit=1000');
    const { locationId, actorId } = all[0]!;
    expect((await api.get<Row[]>(`/inventory-transactions?locationId=${locationId}`)).every((t) => t.locationId === locationId)).toBe(true);
    expect((await api.get<Row[]>(`/inventory-transactions?actorId=${actorId}`)).every((t) => t.actorId === actorId)).toBe(true);
    const sabelo = await api.get<Row[]>('/inventory-transactions?q=sabelo');
    expect(sabelo.length).toBeGreaterThan(0);
    expect(sabelo.every((t) => t.recipientName === 'Sabelo')).toBe(true);

    const summary = await api.get<{ total: number; byType: Record<string, number> }>('/inventory-transactions/summary');
    expect(summary.total).toBe(all.length);
    expect(summary.byType.ISSUE).toBe(all.filter((t) => t.type === 'ISSUE').length);
  });

  it('lists who has posted movements, by name', async () => {
    const actors = await api.get<Array<{ id: string; name: string }>>('/inventory-transactions/actors');
    expect(actors.length).toBeGreaterThan(0);
    expect(actors.every((a) => a.id && a.name)).toBe(true);
  });
});

interface Activity { id: string; entityType: string; summary: string; actorName: string; link: string | null }

interface Count { id: string; locationName: string; countedByName: string; counted: number; adjusted: number; differences: Array<{ sku: string; quantity: string }>; lines: Array<{ expected: string; counted: string; note?: string | null }> }

describe('mock movement reports', () => {
  it('lists issue slips: one per issue with all its lines, earlier issues one line each', async () => {
    const fresh = createMockApi();
    const stock = await fresh.get<Array<{ materialId: string; locationId: string; quantity: string }>>('/reports/current-stock?locationId=loc-1');
    const [a, b] = stock.filter((r) => Number(r.quantity) > 1);
    await fresh.post('/inventory-issues', { recipientId: 'rcp-2', lines: [{ materialId: a!.materialId, locationId: 'loc-1', quantity: 1 }, { materialId: b!.materialId, locationId: 'loc-1', quantity: 1 }] });

    type Slip = { id: string; recipientName: string | null; lines: Array<{ issueId: string; materialId: string }> };
    const slips = await fresh.get<Slip[]>('/inventory-issues?limit=200');
    expect(slips[0]!.recipientName).toBe('Khodani');
    expect(slips[0]!.lines.map((l) => l.materialId).sort()).toEqual([a!.materialId, b!.materialId].sort());
    expect(new Set(slips[0]!.lines.map((l) => l.issueId)).size).toBe(1);
    // The seed's two Boiler Shop issues to KTS went out together; older issues stand alone.
    expect(slips.find((s) => s.id === 'iss-seed-2')!.lines).toHaveLength(2);
    expect(slips.find((s) => s.id === 't-9')!.lines).toHaveLength(1);
    // A slip is found by any of its lines, and comes back whole.
    const byItem = await fresh.get<Slip[]>(`/inventory-issues?materialId=${a!.materialId}&limit=200`);
    expect(byItem.find((s) => s.id === slips[0]!.id)!.lines).toHaveLength(2);
  });

  it('lists every stock count with its differences, including one with none, by location, and not under Other changes', async () => {
    const fresh = createMockApi();
    const stock = await fresh.get<Array<{ materialId: string; locationId: string; quantity: string }>>('/reports/current-stock?locationId=loc-1');
    const [a, b] = stock.filter((r) => Number(r.quantity) > 1);
    await fresh.post('/stock-counts', { locationId: 'loc-1', lines: [{ materialId: a!.materialId, expectedQuantity: Number(a!.quantity), countedQuantity: Number(a!.quantity) }] });
    await fresh.post('/stock-counts', { locationId: 'loc-1', note: 'Monthly', lines: [{ materialId: b!.materialId, expectedQuantity: Number(b!.quantity), countedQuantity: Number(b!.quantity) - 1, note: 'one cracked' }] });

    const counts = await fresh.get<Count[]>('/stock-counts?locationId=loc-1');
    expect(counts[0]).toMatchObject({ locationName: 'Main Storeroom', countedByName: 'System Administrator (dev)', counted: 1, adjusted: 1 });
    // The full sheet keeps the matched item too, with what the system had.
    expect(counts[0]!.lines.map((l) => [l.expected, l.counted])).toEqual([[b!.quantity, String(Number(b!.quantity) - 1)]]);
    expect(counts[1]!.lines.map((l) => [l.expected, l.counted])).toEqual([[a!.quantity, a!.quantity]]);
    expect(counts[0]!.lines[0]!.note).toBe('one cracked');
    const adjustment = (await fresh.get<Array<{ reasonNote: string | null; referenceType: string | null }>>(`/inventory-transactions?materialId=${b!.materialId}&limit=5`))[0]!;
    expect(adjustment.reasonNote).toBe('Stock count: Monthly — one cracked');
    expect(counts[0]!.differences.map((d) => d.quantity)).toEqual(['-1']);
    expect(counts[1]).toMatchObject({ adjusted: 0, differences: [] });
    expect(await fresh.get<Count[]>('/stock-counts?locationId=loc-2')).toEqual([]);
    expect((await fresh.get<Activity[]>('/activity')).some((x) => x.entityType === 'StockCount')).toBe(false);

    // Count differences belong to Stock counts, not to Write-offs.
    const writeoffs = await fresh.get<Array<{ referenceType?: string | null; type: string }>>('/inventory-transactions?report=writeoffs&limit=1000');
    expect(writeoffs.every((t) => t.type === 'ADJUSTMENT' && t.referenceType !== 'StockCount')).toBe(true);
  });

  it('lists received stock by delivery, with its supplier, note and lines', async () => {
    const receipts = await api.get<Array<{ number: string; supplierName: string; deliveryRef: string | null; lines: Array<{ sku: string; locationName: string; quantity: string }> }>>('/stock-receipts?limit=50');
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts[0]!.supplierName).toBeTruthy();
    expect(receipts[0]!.lines[0]).toMatchObject({ sku: expect.any(String), locationName: expect.any(String) });
    const found = await api.get<typeof receipts>(`/stock-receipts?q=${encodeURIComponent(receipts[0]!.deliveryRef ?? receipts[0]!.number)}`);
    expect(found.map((r) => r.number)).toContain(receipts[0]!.number);
  });

  it('shows each transfer once, by its out leg, with where the stock went', async () => {
    const transfers = await api.get<Array<{ type: string; locationName: string; otherLocationName: string | null }>>('/inventory-transactions?report=transfers&limit=1000');
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.every((t) => t.type === 'TRANSFER_OUT' && t.otherLocationName && t.otherLocationName !== t.locationName)).toBe(true);
  });
});

describe('mock other activity', () => {

  it('leaves out settings changes and reversals', async () => {
    const fresh = createMockApi();
    await fresh.patch('/settings', { updates: { 'inventory.urgentBelowPercent': 25 } });
    const list = await fresh.get<Activity[]>('/activity');
    expect(list.some((a) => a.entityType === 'Setting' || a.entityType === 'InventoryTransaction')).toBe(false);
    // Settings > Change history still has it.
    const history = await fresh.get<Array<{ entityId: string }>>('/audit?entityType=Setting');
    expect(history.map((h) => h.entityId)).toContain('inventory.urgentBelowPercent');
  });
});
