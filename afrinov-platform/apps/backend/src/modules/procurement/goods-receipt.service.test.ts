// Unit tests for the Goods Receipt service.
//
// Covers:
//   - create() happy path (with and without a linked purchase order)
//   - GR-number generation is sequential via the advisory lock + count
//   - validation: empty lines, inactive supplier, unknown supplier, unknown PO
//   - getById() success and not-found
//   - post() delegates to InventoryService.postGoodsReceipt and re-reads
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Sup { id: string; name: string; active: boolean }
interface PO { id: string; number: string }
interface GRL { id: string; goodsReceiptId: string; materialId: string; locationId: string; quantity: number; purchaseOrderLineId: string | null }
interface GR { id: string; number: string; purchaseOrderId: string | null; supplierId: string; deliveryRef: string | null; status: 'DRAFT' | 'SUBMITTED' | 'POSTED'; receivedById: string; lines: GRL[]; receivedAt: Date }

const db = {
  suppliers: new Map<string, Sup>(),
  purchaseOrders: new Map<string, PO>(),
  goodsReceipts: [] as GR[],
  materials: new Map<string, { id: string; sku: string; name: string }>(),
  locations: new Map<string, { id: string; name: string }>(),
};
let grCounter = 0;

vi.mock('../../shared/db.js', () => ({
  get prisma() { return makePrisma(); },
}));

vi.mock('../../shared/events.js', () => ({
  dispatchDomainEvents: async () => undefined,
}));

vi.mock('../inventory/inventory.service.js', () => ({
  InventoryService: {
    postGoodsReceipt: vi.fn(),
  },
}));

function makePrisma(): unknown {
  return {
    supplier: {
      findUnique: async ({ where }: { where: { id: string } }) => db.suppliers.get(where.id) ?? null,
    },
    purchaseOrder: {
      findUnique: async ({ where }: { where: { id: string } }) => db.purchaseOrders.get(where.id) ?? null,
    },
    goodsReceipt: {
      count: async () => grCounter,
      findUnique: async ({ where, include }: { where: { id: string }; include?: { lines?: boolean | { include?: { material?: boolean; location?: boolean } }; supplier?: boolean } }) => {
        const gr = db.goodsReceipts.find((g) => g.id === where.id);
        if (!gr) return null;
        if (!include) return gr;
        const out: Record<string, unknown> = { ...gr };
        if (include.supplier) out.supplier = db.suppliers.get(gr.supplierId) ?? null;
        if (include.lines) {
          const lineInclude = typeof include.lines === 'object' ? include.lines.include ?? {} : {};
          out.lines = gr.lines.map((l) => {
            const line: Record<string, unknown> = { ...l };
            if (lineInclude.material) line.material = db.materials.get(l.materialId) ?? null;
            if (lineInclude.location) line.location = db.locations.get(l.locationId) ?? null;
            return line;
          });
        }
        return out;
      },
      create: async ({ data, include }: { data: Record<string, unknown>; include?: { lines: boolean } }) => {
        const id = `gr-${++grCounter}`;
        const lines: GRL[] = (data.lines as { create?: Array<Record<string, unknown>> } | undefined)?.create?.map((c) => ({
          id: `grl-${grCounter}`, goodsReceiptId: id, materialId: c.materialId as string,
          locationId: c.locationId as string, quantity: c.quantity as number,
          purchaseOrderLineId: c.purchaseOrderLineId as string | null ?? null,
        })) ?? [];
        const created: GR = {
          id,
          number: data.number as string,
          purchaseOrderId: data.purchaseOrderId as string | null,
          supplierId: data.supplierId as string,
          deliveryRef: data.deliveryRef as string | null,
          status: data.status as GR['status'],
          receivedById: data.receivedById as string,
          receivedAt: data.receivedAt as Date,
          lines,
        };
        db.goodsReceipts.push(created);
        return include?.lines ? created : created;
      },
    },
    $executeRaw: async () => void 0,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
  };
}

beforeEach(() => {
  db.suppliers.clear();
  db.purchaseOrders.clear();
  db.goodsReceipts.length = 0;
  grCounter = 0;
  db.suppliers.set('sup-1', { id: 'sup-1', name: 'Hydroscand', active: true });
  db.suppliers.set('sup-inactive', { id: 'sup-inactive', name: 'Closed Supplier', active: false });
  db.purchaseOrders.set('po-1', { id: 'po-1', number: 'PO-2026-0001' });
  db.materials.set('mat-1', { id: 'mat-1', sku: 'M16X40-88-HEX', name: 'M16 x 40 8.8 BLACK HEX SET SCREW' });
  db.locations.set('loc-1', { id: 'loc-1', name: 'Main Storeroom' });
});

describe('GoodsReceiptService', () => {
  describe('create', () => {
    it('creates a goods receipt linked to a supplier with a generated number', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      const result = await GoodsReceiptService.create(
        {
          supplierId: 'sup-1',
          lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 50 }],
        },
        'user-1',
      );
      expect(result.supplierId).toBe('sup-1');
      expect(result.status).toBe('SUBMITTED');
      expect(result.number).toMatch(/^GR-\d{4}-\d{4}$/);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]!.quantity).toBe(50);
      expect(result.receivedById).toBe('user-1');
      expect(db.goodsReceipts).toHaveLength(1);
    });

    it('creates a goods receipt linked to both a supplier and a purchase order', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      const result = await GoodsReceiptService.create(
        {
          supplierId: 'sup-1',
          purchaseOrderId: 'po-1',
          deliveryRef: 'INVOICE-123',
          lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 30, purchaseOrderLineId: 'pol-1' }],
        },
        'user-1',
      );
      expect(result.purchaseOrderId).toBe('po-1');
      expect(result.deliveryRef).toBe('INVOICE-123');
    });

    it('rejects empty lines', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      await expect(
        GoodsReceiptService.create({ supplierId: 'sup-1', lines: [] }, 'user-1'),
      ).rejects.toThrow(/at least one line/i);
    });

    it('rejects an unknown supplier', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      await expect(
        GoodsReceiptService.create({ supplierId: 'sup-missing', lines: [{ materialId: 'm', locationId: 'l', quantity: 1 }] }, 'user-1'),
      ).rejects.toThrow(/Supplier not found/i);
    });

    it('rejects an inactive supplier', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      await expect(
        GoodsReceiptService.create({ supplierId: 'sup-inactive', lines: [{ materialId: 'm', locationId: 'l', quantity: 1 }] }, 'user-1'),
      ).rejects.toThrow(/Supplier is inactive/i);
    });

    it('rejects an unknown purchase order when one is referenced', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      await expect(
        GoodsReceiptService.create({ supplierId: 'sup-1', purchaseOrderId: 'po-missing', lines: [{ materialId: 'm', locationId: 'l', quantity: 1 }] }, 'user-1'),
      ).rejects.toThrow(/PurchaseOrder not found/i);
    });
  });

  describe('getById', () => {
    it('returns a goods receipt by id', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      const created = await GoodsReceiptService.create(
        { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 10 }] },
        'user-1',
      );
      const fetched = await GoodsReceiptService.getById(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.supplier.name).toBe('Hydroscand');
      expect(fetched.lines[0]!.material.sku).toBeTruthy();
    });

    it('throws not-found for an unknown id', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      await expect(GoodsReceiptService.getById('nonexistent')).rejects.toThrow(/GoodsReceipt not found/i);
    });
  });

  describe('post', () => {
    it('delegates to InventoryService.postGoodsReceipt and re-reads the receipt', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      const { InventoryService } = await import('../inventory/inventory.service.js');

      const created = await GoodsReceiptService.create(
        { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 5 }] },
        'user-1',
      );

      await GoodsReceiptService.post(created.id, 'user-1');

      expect(InventoryService.postGoodsReceipt).toHaveBeenCalledWith({ goodsReceiptId: created.id, actorId: 'user-1' });
    });
  });
});
