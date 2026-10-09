// Unit tests for StockReceiptService: receiving stock at the counter.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Trx = { id: string; materialId: string; locationId: string; type: string; quantity: Prisma.Decimal; referenceType: string; referenceId: string; actorId: string };
type GR = { id: string; number: string; supplierId: string; deliveryRef: string; status: string; receivedAt: Date; lines: unknown };

const db = {
  suppliers: new Map<string, { id: string; name: string; active: boolean }>(),
  materials: new Map<string, { id: string; sku: string; active: boolean }>(),
  locations: new Map<string, { id: string; name: string; active: boolean }>(),
  receipts: [] as GR[],
  trx: [] as Trx[],
  balances: new Map<string, Prisma.Decimal>(),
  audit: [] as Array<{ action: string; entityId: string }>,
};
let seq = 0;

function makeTx() {
  return {
    supplier: { findUnique: async ({ where }: { where: { id: string } }) => db.suppliers.get(where.id) ?? null },
    material: { findUnique: async ({ where }: { where: { id: string } }) => db.materials.get(where.id) ?? null },
    location: { findUnique: async ({ where }: { where: { id: string } }) => db.locations.get(where.id) ?? null },
    goodsReceipt: {
      count: async () => db.receipts.length,
      create: async ({ data }: { data: Omit<GR, 'id'> }) => {
        const gr = { ...data, id: `gr-${++seq}` };
        db.receipts.push(gr);
        return gr;
      },
    },
    inventoryTransaction: {
      create: async ({ data }: { data: Omit<Trx, 'id'> }) => {
        const t = { ...data, id: `t-${++seq}` };
        db.trx.push(t);
        return t;
      },
      aggregate: async ({ where }: { where: { materialId: string; locationId: string } }) => ({
        _sum: {
          quantity: db.trx
            .filter((t) => t.materialId === where.materialId && t.locationId === where.locationId)
            .reduce((a, t) => a.plus(t.quantity), new Prisma.Decimal(0)),
        },
      }),
    },
    inventoryBalance: {
      upsert: async ({ create }: { create: { materialId: string; locationId: string; quantity: Prisma.Decimal } }) => {
        db.balances.set(`${create.materialId}|${create.locationId}`, create.quantity);
        return create;
      },
    },
    auditLogEntry: { create: async ({ data }: { data: { action: string; entityId: string } }) => { db.audit.push(data); return data; } },
    $executeRaw: async () => 0,
  };
}

// Writes are applied as they happen; a refusal is thrown before any write,
// which is what the service promises (all checks come first).
vi.mock('../../shared/db.js', () => ({
  prisma: { $transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()) },
}));
vi.mock('../../shared/events.js', () => ({ dispatchDomainEvents: async () => undefined }));

const { StockReceiptService } = await import('./stock-receipt.service.js');

const base = {
  supplierId: 'sup-1',
  deliveryRef: 'INV-2041',
  actorId: 'storeman',
  lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 20 }],
};

beforeEach(() => {
  db.suppliers.clear(); db.materials.clear(); db.locations.clear();
  db.receipts.length = 0; db.trx.length = 0; db.balances.clear(); db.audit.length = 0; seq = 0;
  db.suppliers.set('sup-1', { id: 'sup-1', name: 'Hydroscand', active: true });
  db.suppliers.set('sup-old', { id: 'sup-old', name: 'Closed Ltd', active: false });
  db.materials.set('mat-1', { id: 'mat-1', sku: 'DISC-115', active: true });
  db.materials.set('mat-2', { id: 'mat-2', sku: 'GLOVE-L', active: true });
  db.materials.set('mat-old', { id: 'mat-old', sku: 'OLD-1', active: false });
  db.locations.set('loc-1', { id: 'loc-1', name: 'A-1', active: true });
});

describe('StockReceiptService.receive', () => {
  it('records a posted goods receipt with no purchase order and books every line', async () => {
    const result = await StockReceiptService.receive({
      ...base,
      lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 20 }, { materialId: 'mat-2', locationId: 'loc-1', quantity: '4.5' }],
    });
    expect(result.number).toMatch(/^GR-\d{4}-0001$/);
    expect(result.transactionIds).toHaveLength(2);
    expect(db.receipts[0]).toMatchObject({ supplierId: 'sup-1', deliveryRef: 'INV-2041', status: 'POSTED' });
    expect(db.receipts[0]).not.toHaveProperty('purchaseOrderId');
    expect(db.trx.map((t) => [t.type, t.referenceType, t.referenceId, t.quantity.toString()])).toEqual([
      ['RECEIPT', 'GoodsReceipt', result.goodsReceiptId, '20'],
      ['RECEIPT', 'GoodsReceipt', result.goodsReceiptId, '4.5'],
    ]);
    expect(db.balances.get('mat-1|loc-1')?.toString()).toBe('20');
    expect(db.audit).toEqual([expect.objectContaining({ action: 'RECEIVE_STOCK', entityId: result.goodsReceiptId })]);
  });

  it('keeps the date on the delivery note', async () => {
    await StockReceiptService.receive({ ...base, receivedAt: '2026-10-01' });
    expect(db.receipts[0]!.receivedAt.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it.each([
    ['a blank delivery/invoice number', { deliveryRef: '  ' }, /delivery note or invoice number/],
    ['no lines', { lines: [] }, /at least one item/],
    ['a quantity that is not positive', { lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 0 }] }, /must be positive/],
    ['a delivery date in the future', { receivedAt: '2999-01-01' }, /cannot be in the future/],
    ['an unknown supplier', { supplierId: 'nope' }, /Supplier not found/],
    ['an inactive supplier', { supplierId: 'sup-old' }, /Supplier is inactive/],
    ['an inactive material', { lines: [{ materialId: 'mat-old', locationId: 'loc-1', quantity: 1 }] }, /OLD-1 is inactive/],
    ['an unknown location', { lines: [{ materialId: 'mat-1', locationId: 'nowhere', quantity: 1 }] }, /Location not found/],
  ])('refuses %s and records nothing', async (_case, override, message) => {
    await expect(StockReceiptService.receive({ ...base, ...override })).rejects.toThrow(message);
    expect(db.receipts).toHaveLength(0);
    expect(db.trx).toHaveLength(0);
  });
});
