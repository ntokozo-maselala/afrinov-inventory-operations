// Posting a stock count keeps its full sheet: every item counted, matched or
// not, with what the system had, besides the adjustments for the differences.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { tx } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(async () => 0),
    location: { findUnique: vi.fn() },
    material: { findMany: vi.fn() },
    inventoryTransaction: { create: vi.fn() },
    stockCountLine: { createMany: vi.fn() },
    auditLogEntry: { create: vi.fn() },
  },
}));
vi.mock('../../shared/db.js', () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }));
vi.mock('../../shared/inventory/balances.js', () => ({
  getCurrentBalance: vi.fn(async (materialId: string) => new Prisma.Decimal(materialId === 'm-1' ? 10 : 4)),
  recomputeBalance: vi.fn(async () => undefined),
}));
vi.mock('../../shared/events.js', () => ({ dispatchDomainEvents: vi.fn(async () => undefined) }));

const { StockCountService } = await import('./stock-count.service.js');

describe('StockCountService.post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.location.findUnique.mockResolvedValue({ id: 'l-1', name: 'Boiler Shop', active: true });
    tx.material.findMany.mockResolvedValue([{ id: 'm-1', sku: 'DISC-115' }, { id: 'm-2', sku: 'GLOVE-L' }]);
    tx.inventoryTransaction.create.mockResolvedValue({ id: 'tx-1' });
  });

  it('saves every counted item, the one that matched as well as the one that did not', async () => {
    const result = await StockCountService.post({
      locationId: 'l-1', actorId: 'u-1',
      lines: [
        { materialId: 'm-1', expectedQuantity: 10, countedQuantity: 7, note: ' 3 cracked, binned ' },
        { materialId: 'm-2', expectedQuantity: 4, countedQuantity: 4 },
      ],
      note: 'Monthly',
    });
    expect(result).toMatchObject({ counted: 2, adjusted: 1 });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledTimes(1);
    const { data } = tx.stockCountLine.createMany.mock.calls[0]![0];
    expect(data.map((l: { materialId: string; expectedQuantity: Prisma.Decimal; countedQuantity: Prisma.Decimal; countId: string; note: string | null }) => [
      l.materialId, l.expectedQuantity.toString(), l.countedQuantity.toString(), l.countId, l.note,
    ])).toEqual([
      ['m-1', '10', '7', result.countId, '3 cracked, binned'],
      ['m-2', '4', '4', result.countId, null],
    ]);
    // The item's note joins the count's on its adjustment.
    expect(tx.inventoryTransaction.create.mock.calls[0]![0].data.reasonNote).toBe('Stock count: Monthly — 3 cracked, binned');
  });

  it('saves no sheet when stock moved while counting, because nothing is posted', async () => {
    await expect(StockCountService.post({
      locationId: 'l-1', actorId: 'u-1', lines: [{ materialId: 'm-1', expectedQuantity: 9, countedQuantity: 7 }],
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.stockCountLine.createMany).not.toHaveBeenCalled();
  });
});
