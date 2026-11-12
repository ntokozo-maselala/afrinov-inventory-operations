// Posting a stock count keeps its full sheet: every item counted, matched or
// not, with what the system had, besides the adjustments for the differences.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { tx } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(async () => 0),
    location: { findUnique: vi.fn() },
    material: { findMany: vi.fn(), findUnique: vi.fn(async () => ({ sku: 'S', active: true })) },
    // Nothing written off in the last 7 days (system audit C2).
    inventoryTransaction: { create: vi.fn(), aggregate: vi.fn(async () => ({ _sum: { quantity: null } })) },
    stockCountLine: { createMany: vi.fn() },
    auditLogEntry: { create: vi.fn() },
    adjustmentRequest: { findMany: vi.fn(), create: vi.fn() },
    // No rows: the write-off settings at their defaults (approval on, R 1 000).
    setting: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('../../shared/db.js', () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }));
vi.mock('../../shared/inventory/balances.js', () => ({
  getCurrentBalance: vi.fn(async ({ materialId }: { materialId: string }) => new Prisma.Decimal(materialId === 'm-1' ? 10 : 4)),
  recomputeBalance: vi.fn(async () => undefined),
  lockInventoryBalances: vi.fn(async () => undefined),
  storesStock: (materialId: string, locationId: string) => ({ materialId, locationId, heldForProject: null }),
}));
vi.mock('../../shared/events.js', () => ({ dispatchDomainEvents: vi.fn(async () => undefined) }));

const { StockCountService } = await import('./stock-count.service.js');

describe('StockCountService.post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.location.findUnique.mockResolvedValue({ id: 'l-1', name: 'Boiler Shop', active: true });
    tx.material.findMany.mockResolvedValue([
      { id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitCost: new Prisma.Decimal(5), unitOfMeasure: 'each', unit: { kind: 'COUNTED' } },
      { id: 'm-2', sku: 'GLOVE-L', name: 'Welding gloves', unitCost: new Prisma.Decimal(5), unitOfMeasure: 'pair', unit: { kind: 'COUNTED' } },
    ]);
    tx.inventoryTransaction.create.mockResolvedValue({ id: 'tx-1' });
    tx.adjustmentRequest.findMany.mockResolvedValue([]);
    tx.adjustmentRequest.create.mockResolvedValue({ id: 'req-1' });
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

  // ADR-028; Qodo, PR #151: a count is no way round the write-off limit.
  it('holds a difference over the write-off limit for approval and posts the rest', async () => {
    tx.material.findMany.mockResolvedValue([
      { id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitCost: new Prisma.Decimal(500), unitOfMeasure: 'each', unit: { kind: 'COUNTED' } },
      { id: 'm-2', sku: 'GLOVE-L', name: 'Welding gloves', unitCost: new Prisma.Decimal(5), unitOfMeasure: 'pair', unit: { kind: 'COUNTED' } },
    ]);
    const result = await StockCountService.post({
      locationId: 'l-1', actorId: 'u-1', note: 'Monthly',
      lines: [{ materialId: 'm-1', expectedQuantity: 10, countedQuantity: 7 }, { materialId: 'm-2', expectedQuantity: 4, countedQuantity: 3 }],
    });
    expect(result).toMatchObject({ adjusted: 1, waitingForApproval: 1 });
    expect(result.lines).toEqual([
      { materialId: 'm-1', variance: '-3', transactionId: null, requestId: 'req-1' },
      { materialId: 'm-2', variance: '-1', transactionId: 'tx-1', requestId: null },
    ]);
    const { data } = tx.adjustmentRequest.create.mock.calls[0]![0];
    expect(data).toMatchObject({ materialId: 'm-1', reasonCode: 'COUNT_VARIANCE', referenceType: 'StockCount', referenceId: result.countId, reasonNote: 'Stock count: Monthly' });
    expect(data.value.toString()).toBe('1500');
  });

  it('refuses to count an item with an adjustment already waiting, so it is not corrected twice', async () => {
    tx.adjustmentRequest.findMany.mockResolvedValue([{ materialId: 'm-1' }]);
    await expect(StockCountService.post({ locationId: 'l-1', actorId: 'u-1', lines: [{ materialId: 'm-1', expectedQuantity: 10, countedQuantity: 7 }] }))
      .rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringMatching(/^DISC-115 at Boiler Shop already has an adjustment waiting for approval/) });
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  // Qodo, PR #151: two quantities that each fit can differ by more than the column holds.
  it('refuses a difference too large to post as one movement', async () => {
    const { getCurrentBalance } = await import('../../shared/inventory/balances.js');
    vi.mocked(getCurrentBalance).mockResolvedValueOnce(new Prisma.Decimal('-90000000000000'));
    await expect(StockCountService.post({ locationId: 'l-1', actorId: 'u-1', lines: [{ materialId: 'm-1', expectedQuantity: -90000000000000, countedQuantity: 90000000000000 }] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/DISC-115 is too large to post as one movement/) });
  });

  it('saves no sheet when stock moved while counting, because nothing is posted', async () => {
    await expect(StockCountService.post({
      locationId: 'l-1', actorId: 'u-1', lines: [{ materialId: 'm-1', expectedQuantity: 9, countedQuantity: 7 }],
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.stockCountLine.createMany).not.toHaveBeenCalled();
  });
});
