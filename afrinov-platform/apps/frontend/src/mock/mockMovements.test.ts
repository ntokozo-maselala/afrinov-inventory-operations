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
