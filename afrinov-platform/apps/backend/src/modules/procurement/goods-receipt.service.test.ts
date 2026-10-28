// Unit tests for the Goods Receipt service.
//
// Covers:
//   - create() happy path (with and without a linked purchase order)
//   - GR-number generation continues from the year's highest number
//   - create() with post records and posts in the same transaction
//   - validation: empty lines, inactive supplier, unknown supplier, unknown PO
//   - getById() success and not-found
//   - post() delegates to InventoryService.postGoodsReceipt and re-reads
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

interface Sup { id: string; name: string; active: boolean }
interface POL { id: string; materialId: string; orderedQty: Prisma.Decimal; receivedQty: Prisma.Decimal; material: { sku: string } }
interface PO { id: string; number: string; status: string; supplierId?: string; lines?: POL[] }
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
/** The year's highest receipt number, as the numbering query answers it. */
let highestNumber: number | null = null;
/** What the transaction did, in order. */
const steps: string[] = [];

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
      update: async ({ where, data }: { where: { id: string }; data: { number: string } }) => {
        const gr = db.goodsReceipts.find((g) => g.id === where.id)!;
        gr.number = data.number;
        return gr;
      },
    },
    $executeRaw: async () => { steps.push('numbering lock'); },
    // The highest number among receipts already numbered.
    $queryRaw: async () => [{ last: highestNumber ?? (db.goodsReceipts.filter((g) => !g.number.startsWith('PENDING-')).length || null) }],
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
  };
}

beforeEach(() => {
  db.suppliers.clear();
  db.purchaseOrders.clear();
  db.goodsReceipts.length = 0;
  grCounter = 0;
  highestNumber = null;
  steps.length = 0;
  db.suppliers.set('sup-1', { id: 'sup-1', name: 'Hydroscand', active: true });
  db.suppliers.set('sup-inactive', { id: 'sup-inactive', name: 'Closed Supplier', active: false });
  db.purchaseOrders.set('po-1', {
    id: 'po-1', number: 'PO-2026-0001', status: 'APPROVED', supplierId: 'sup-1',
    lines: [{ id: 'pol-1', materialId: 'mat-1', orderedQty: new Prisma.Decimal(50), receivedQty: new Prisma.Decimal(10), material: { sku: 'M16X40-88-HEX' } }],
  });
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

    // A receipt against an order credits the order's lines (procurement workflow Phase 1).
    describe('against a purchase order', () => {
      const receive = async (lines: Array<{ materialId: string; quantity: number; purchaseOrderLineId?: string }>, over: Record<string, unknown> = {}) => {
        const { GoodsReceiptService } = await import('./goods-receipt.service.js');
        return GoodsReceiptService.create(
          { supplierId: 'sup-1', purchaseOrderId: 'po-1', lines: lines.map((l) => ({ locationId: 'loc-1', ...l })), ...over },
          'user-1',
        );
      };

      it('refuses a line that does not name its order line', async () => {
        await expect(receive([{ materialId: 'mat-1', quantity: 5 }]))
          .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Every line of a receipt against PO-2026-0001 must name the order line it is for.' });
        expect(db.goodsReceipts).toHaveLength(0);
      });

      it('refuses an order line from somewhere else, or for another item', async () => {
        await expect(receive([{ materialId: 'mat-1', quantity: 5, purchaseOrderLineId: 'pol-elsewhere' }]))
          .rejects.toMatchObject({ message: 'A line is not on PO-2026-0001.' });
        await expect(receive([{ materialId: 'mat-other', quantity: 5, purchaseOrderLineId: 'pol-1' }]))
          .rejects.toMatchObject({ message: 'That line of PO-2026-0001 is for M16X40-88-HEX, not the item given.' });
      });

      it('refuses more than is still outstanding, counting every line for the same order line', async () => {
        // Ordered 50, 10 received: 40 outstanding.
        await expect(receive([{ materialId: 'mat-1', quantity: 25, purchaseOrderLineId: 'pol-1' }, { materialId: 'mat-1', quantity: 16, purchaseOrderLineId: 'pol-1' }]))
          .rejects.toMatchObject({ message: 'Receiving 41 of M16X40-88-HEX would exceed what is still outstanding on PO-2026-0001 (40).' });
        await expect(receive([{ materialId: 'mat-1', quantity: 40, purchaseOrderLineId: 'pol-1' }])).resolves.toMatchObject({ purchaseOrderId: 'po-1' });
      });

      it("refuses another supplier's delivery against the order", async () => {
        db.suppliers.set('sup-2', { id: 'sup-2', name: 'Other', active: true });
        await expect(receive([{ materialId: 'mat-1', quantity: 5, purchaseOrderLineId: 'pol-1' }], { supplierId: 'sup-2' }))
          .rejects.toMatchObject({ message: "PO-2026-0001 is with another supplier. Choose the order's supplier, or another order." });
      });

      it('refuses order lines on a receipt with no order', async () => {
        const { GoodsReceiptService } = await import('./goods-receipt.service.js');
        await expect(GoodsReceiptService.create({ supplierId: 'sup-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 5, purchaseOrderLineId: 'pol-1' }] }, 'user-1'))
          .rejects.toMatchObject({ message: 'These lines belong to a purchase order: choose the order the delivery is for.' });
      });
    });

    it.each(['DRAFT', 'PENDING_APPROVAL', 'RECEIVED', 'CLOSED', 'CANCELLED'])(
      'refuses to receive against a purchase order that is %s',
      async (status) => {
        db.purchaseOrders.set('po-1', { id: 'po-1', number: 'PO-2026-0001', status });
        const { GoodsReceiptService } = await import('./goods-receipt.service.js');
        await expect(
          GoodsReceiptService.create(
            { supplierId: 'sup-1', purchaseOrderId: 'po-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] },
            'user-1',
          ),
        ).rejects.toThrow(new RegExp(`status ${status}`));
        expect(db.goodsReceipts).toHaveLength(0);
      },
    );

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

  describe('numbering', () => {
    it('continues from the highest number this year, so a deleted receipt cannot make a number repeat', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      // Three receipts left, the highest GR-…-0007: counting them would issue 0004.
      highestNumber = 7;
      const result = await GoodsReceiptService.create(
        { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] },
        'user-1',
      );
      expect(result.number).toBe(`GR-${new Date().getFullYear()}-0008`);
    });
  });

  describe('create with post', () => {
    it('posts the receipt in the transaction it was recorded in', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      const { InventoryService } = await import('../inventory/inventory.service.js');
      vi.mocked(InventoryService.postGoodsReceipt).mockReset().mockResolvedValue(undefined);
      const received = await GoodsReceiptService.receive(
        { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 5 }] },
        'user-1',
      );
      expect(InventoryService.postGoodsReceipt).toHaveBeenCalledWith({ goodsReceiptId: received.id, actorId: 'user-1' }, expect.anything());
    });

    // As Receive stock does: receipts post one at a time, so two cannot recompute
    // one balance at once, and both take their locks in the same order (no deadlock).
    it('takes the numbering lock before posting, and holds it while stock is booked', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      const { InventoryService } = await import('../inventory/inventory.service.js');
      vi.mocked(InventoryService.postGoodsReceipt).mockReset().mockImplementation(async () => { steps.push('post'); });
      const received = await GoodsReceiptService.receive(
        { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 5 }] },
        'user-1',
      );
      expect(steps).toEqual(['numbering lock', 'post']);
      expect(received.number).toBe(`GR-${new Date().getFullYear()}-0001`);
      vi.mocked(InventoryService.postGoodsReceipt).mockReset();
    });

    it('fails as a whole when posting fails, rather than leaving the receipt recorded', async () => {
      const { GoodsReceiptService } = await import('./goods-receipt.service.js');
      const { InventoryService } = await import('../inventory/inventory.service.js');
      vi.mocked(InventoryService.postGoodsReceipt).mockReset().mockRejectedValue(new Error('posting failed'));
      // The error leaves the transaction, so the database undoes the receipt with it.
      await expect(GoodsReceiptService.receive(
        { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 5 }] },
        'user-1',
      )).rejects.toThrow('posting failed');
      vi.mocked(InventoryService.postGoodsReceipt).mockReset();
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
