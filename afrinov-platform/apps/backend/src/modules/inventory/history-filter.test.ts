// The Movements filter: which ledger rows a date range, location, user and
// search select, and how the paging cursor continues a list.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../shared/db.js', () => ({
  prisma: { inventoryTransaction: { findMany }, goodsReceipt: { findMany: vi.fn(async () => []) } },
}));

const { historyWhere, historyCursor, InventoryService } = await import('./inventory.service.js');

describe('historyWhere', () => {
  it('treats days as whole UTC days and includes the last one', () => {
    const where = historyWhere({ from: '2026-10-01', to: '2026-10-31' });
    expect(where.postedAt).toEqual({ gte: new Date('2026-10-01T00:00:00.000Z'), lt: new Date('2026-11-01T00:00:00.000Z') });
  });

  it('accepts a single day as both ends', () => {
    expect(historyWhere({ from: '2026-10-12', to: '2026-10-12' }).postedAt)
      .toEqual({ gte: new Date('2026-10-12T00:00:00.000Z'), lt: new Date('2026-10-13T00:00:00.000Z') });
  });

  it('keeps an exact time as an inclusive end, for callers that pass one', () => {
    expect(historyWhere({ to: '2026-10-12T10:30:00.000Z' }).postedAt).toEqual({ lte: new Date('2026-10-12T10:30:00.000Z') });
  });

  it('refuses a start after the end, and a date that is not one', () => {
    expect(() => historyWhere({ from: '2026-10-31', to: '2026-10-01' })).toThrow(/start date is after the end date/);
    expect(() => historyWhere({ from: 'last week' })).toThrow(/Invalid from date/);
  });

  it('filters by location and by who posted it', () => {
    expect(historyWhere({ locationId: 'l-1', actorId: 'u-1' })).toMatchObject({ locationId: 'l-1', actorId: 'u-1' });
  });

  it('searches item code and name, location, project and who it was issued to, ignoring case', () => {
    const where = historyWhere({ q: '  disc ' });
    const contains = { contains: 'disc', mode: 'insensitive' };
    expect(where.AND).toEqual([{
      OR: [
        { material: { sku: contains } },
        { material: { name: contains } },
        { location: { name: contains } },
        { projectNumber: contains },
        { recipient: { name: contains } },
      ],
    }]);
    expect(historyWhere({ q: '   ' }).AND).toBeUndefined();
  });

  it('selects each report: issued stock, transfers by their out leg, write-offs without count differences', () => {
    expect(historyWhere({ report: 'issued', type: 'RECEIPT' }).type).toBe('ISSUE');
    expect(historyWhere({ report: 'transfers' }).type).toBe('TRANSFER_OUT');
    const writeoffs = historyWhere({ report: 'writeoffs', q: 'disc' });
    expect(writeoffs.type).toBe('ADJUSTMENT');
    // Unreferenced adjustments must stay in: NULL <> 'StockCount' is not true in SQL.
    expect(writeoffs.AND).toEqual([{ OR: [{ referenceType: null }, { referenceType: { not: 'StockCount' } }] }, expect.objectContaining({ OR: expect.any(Array) })]);
  });
});

describe('queryHistory paging', () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  it('orders newest first with ties broken by id, and continues after the cursor', async () => {
    const cursor = historyCursor({ postedAt: new Date('2026-10-05T08:00:00.000Z'), id: 'tx-9' });
    expect(cursor).toBe('2026-10-05T08:00:00.000Z_tx-9');
    await InventoryService.queryHistory({ from: '2026-10-01', before: cursor, limit: 100 });
    const args = findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ postedAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(100);
    expect(args.where.AND[1]).toEqual({
      OR: [
        { postedAt: { lt: new Date('2026-10-05T08:00:00.000Z') } },
        { postedAt: new Date('2026-10-05T08:00:00.000Z'), id: { lt: 'tx-9' } },
      ],
    });
  });

  it('caps a page at 1000 rows unless the caller allows more', async () => {
    await InventoryService.queryHistory({ limit: 50_000 });
    expect(findMany.mock.calls[0]![0].take).toBe(1000);
  });

  it('refuses a cursor it did not issue', async () => {
    await expect(InventoryService.queryHistory({ before: 'nonsense' })).rejects.toThrow(/Invalid paging cursor/);
  });
});
