// The Movements page's grouped reports: received stock (one entry per
// delivery, with its lines) and stock counts (one entry per count, with the
// differences it adjusted).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { grFindMany, auditFindMany, txFindMany, locationFindMany, userFindMany, sheetFindMany } = vi.hoisted(() => ({
  grFindMany: vi.fn(), auditFindMany: vi.fn(), txFindMany: vi.fn(), locationFindMany: vi.fn(), userFindMany: vi.fn(), sheetFindMany: vi.fn(),
}));
vi.mock('../../shared/db.js', () => ({
  prisma: {
    goodsReceipt: { findMany: grFindMany },
    auditLogEntry: { findMany: auditFindMany },
    inventoryTransaction: { findMany: txFindMany },
    location: { findMany: locationFindMany },
    user: { findMany: userFindMany },
    stockCountLine: { findMany: sheetFindMany },
  },
}));

const { StockReceiptService } = await import('./stock-receipt.service.js');
const { StockCountService } = await import('./stock-count.service.js');

const at = new Date('2026-09-25T10:00:00.000Z');
const material = (sku: string, name: string) => ({ sku, name, unitOfMeasure: 'each' });

describe('StockReceiptService.list', () => {
  beforeEach(() => grFindMany.mockReset().mockResolvedValue([]));

  it('returns each delivery with its supplier, note, who received it and its lines', async () => {
    grFindMany.mockResolvedValue([{
      id: 'gr-1', number: 'GR-2026-0007', receivedAt: at, deliveryRef: 'INV-2041',
      supplier: { name: 'Hydroscand' }, receivedBy: { name: 'Vusi' },
      lines: [
        { materialId: 'm-2', material: material('GLOVE-L', 'Welding gloves'), location: { name: 'Boiler Shop' }, quantity: { toString: () => '6' } },
        { materialId: 'm-1', material: material('DISC-115', 'Cutting disc'), location: { name: 'Main Storeroom' }, quantity: { toString: () => '20' } },
      ],
    }]);
    expect(await StockReceiptService.list({ from: '2026-09-25' })).toEqual([{
      id: 'gr-1', cursor: '2026-09-25T10:00:00.000Z_gr-1', number: 'GR-2026-0007', receivedAt: '2026-09-25T10:00:00.000Z',
      supplierName: 'Hydroscand', deliveryRef: 'INV-2041', receivedByName: 'Vusi',
      lines: [
        { materialId: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', locationName: 'Main Storeroom', quantity: '20' },
        { materialId: 'm-2', sku: 'GLOVE-L', name: 'Welding gloves', unitOfMeasure: 'each', locationName: 'Boiler Shop', quantity: '6' },
      ],
    }]);
  });

  it('filters posted deliveries by delivery day, supplier, location and a search, newest first', async () => {
    await StockReceiptService.list({ from: '2026-09-25', supplierId: 's-1', locationId: 'l-1', q: 'inv', before: '2026-09-26T08:00:00.000Z_gr-9', limit: 999 });
    const args = grFindMany.mock.calls[0]![0];
    expect(args.where.AND).toEqual(expect.arrayContaining([
      { status: 'POSTED' },
      { receivedAt: { gte: new Date('2026-09-25T00:00:00.000Z') } },
      { supplierId: 's-1' },
      { lines: { some: { locationId: 'l-1' } } },
      { OR: [{ receivedAt: { lt: new Date('2026-09-26T08:00:00.000Z') } }, { receivedAt: new Date('2026-09-26T08:00:00.000Z'), id: { lt: 'gr-9' } }] },
    ]));
    expect(JSON.stringify(args.where.AND)).toContain('"deliveryRef":{"contains":"inv","mode":"insensitive"}');
    expect(args.orderBy).toEqual([{ receivedAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(200);
  });
});

describe('StockCountService.list', () => {
  beforeEach(() => {
    auditFindMany.mockReset().mockResolvedValue([]);
    txFindMany.mockReset().mockResolvedValue([]);
    locationFindMany.mockReset().mockResolvedValue([{ id: 'l-1', name: 'Boiler Shop' }]);
    userFindMany.mockReset().mockResolvedValue([{ id: 'u-1', name: 'Vusi' }]);
    sheetFindMany.mockReset().mockResolvedValue([]);
  });

  it('returns each count with where, who, how many items and the differences it adjusted', async () => {
    auditFindMany.mockResolvedValue([
      { id: 'a-2', entityId: 'c-2', actorId: 'u-1', createdAt: at, after: { locationId: 'l-1', counted: 4, adjusted: 1, note: 'Monthly' } },
      { id: 'a-1', entityId: 'c-1', actorId: 'u-1', createdAt: at, after: { locationId: 'l-1', counted: 3, adjusted: 0, note: null } },
    ]);
    txFindMany.mockResolvedValue([
      { referenceId: 'c-2', materialId: 'm-1', material: material('DISC-115', 'Cutting disc'), quantity: { toString: () => '-2' } },
    ]);
    sheetFindMany.mockResolvedValue([
      { countId: 'c-2', materialId: 'm-2', material: material('GLOVE-L', 'Welding gloves'), expectedQuantity: { toString: () => '4' }, countedQuantity: { toString: () => '4' } },
      { countId: 'c-2', materialId: 'm-1', material: material('DISC-115', 'Cutting disc'), expectedQuantity: { toString: () => '9' }, countedQuantity: { toString: () => '7' } },
    ]);
    const counts = await StockCountService.list({ locationId: 'l-1' });
    expect(counts).toEqual([
      {
        id: 'c-2', cursor: '2026-09-25T10:00:00.000Z_a-2', at: '2026-09-25T10:00:00.000Z', locationId: 'l-1', locationName: 'Boiler Shop',
        countedByName: 'Vusi', counted: 4, adjusted: 1, note: 'Monthly',
        differences: [{ materialId: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', quantity: '-2' }],
        lines: [
          { materialId: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', expected: '9', counted: '7' },
          { materialId: 'm-2', sku: 'GLOVE-L', name: 'Welding gloves', unitOfMeasure: 'each', expected: '4', counted: '4' },
        ],
      },
      // Counted before sheets were kept: differences only.
      expect.objectContaining({ id: 'c-1', counted: 3, adjusted: 0, differences: [], lines: [] }),
    ]);
    expect(sheetFindMany.mock.calls[0]![0].where).toEqual({ countId: { in: ['c-2', 'c-1'] } });
    expect(txFindMany.mock.calls[0]![0].where).toEqual({ referenceType: 'StockCount', referenceId: { in: ['c-2', 'c-1'] } });
    expect(auditFindMany.mock.calls[0]![0].where.AND).toEqual(expect.arrayContaining([
      { entityType: 'StockCount', action: 'STOCK_COUNT' },
      { after: { path: ['locationId'], equals: 'l-1' } },
    ]));
  });

  it('asks nothing more when no count matches', async () => {
    expect(await StockCountService.list({ from: '2026-09-25', to: '2026-09-25' })).toEqual([]);
    expect(txFindMany).not.toHaveBeenCalled();
  });
});
