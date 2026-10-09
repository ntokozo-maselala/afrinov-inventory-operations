// Unit tests for the ReportingService — the read-only reporting layer.
//
// ReportingService is distinct from ReportService (report.service.ts).
// It exposes: currentStock, lowStock, movementHistory, projectConsumption.
// All reads are computed from the ledger (ADR-002).
//
// Settings are resolved via SettingsService.getValue, which in test mode
// reads from the mocked `setting` table and falls back to catalog defaults
// when no row exists — so tests don't need to seed settings unless they
// want to override a toggle (e.g. enableStockAlerts).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

interface Mat { id: string; sku: string; name: string; category: string; unitOfMeasure: string; requiredStock: Prisma.Decimal; unitCost: Prisma.Decimal | null; active: boolean }
interface Loc { id: string; name: string; type: string; active: boolean }
interface Bal { materialId: string; locationId: string; quantity: Prisma.Decimal; updatedAt: Date }
interface Tx {
  id: string; postedAt: Date; type: string; materialId: string; locationId: string;
  quantity: Prisma.Decimal; actorId: string; recipientId: string | null; reasonCode: string | null;
  reasonNote: string | null; projectNumber: string | null; referenceType: string | null; referenceId: string | null;
  material?: { sku: string; name: string; category: string; unitOfMeasure: string };
  location?: { name: string };
  actor?: { id: string; name: string; email: string };
}

const db = {
  balances: [] as Bal[],
  materials: [] as Mat[],
  locations: [] as Loc[],
  transactions: [] as Tx[],
  receipts: [] as Array<{ materialId: string; receivedAt: Date; supplier: string; status: string }>,
  settings: new Map<string, { value: unknown }>(),
};

const DEC = (n: number) => new Prisma.Decimal(n);

vi.mock('../../shared/db.js', () => ({
  get prisma() { return makePrisma(); },
}));

function makePrisma(): unknown {
  return {
    inventoryBalance: {
      findMany: async ({ where, include }: { where?: { locationId?: string; materialId?: string | { in: string[] } }; include?: unknown } = {}) => {
        let list = db.balances.slice();
        if (where?.locationId) list = list.filter((b) => b.locationId === where.locationId);
        const mid = where?.materialId;
        if (typeof mid === 'string') list = list.filter((b) => b.materialId === mid);
        else if (mid?.in) list = list.filter((b) => mid.in.includes(b.materialId));
        return include ? list.map((b) => ({ ...b, location: { name: db.locations.find((l) => l.id === b.locationId)?.name ?? 'Loc' } })) : list;
      },
      groupBy: async ({ where }: { where?: { materialId?: { in: string[] } } } = {}) => {
        const sums = new Map<string, Prisma.Decimal>();
        for (const b of db.balances) {
          if (where?.materialId?.in && !where.materialId.in.includes(b.materialId)) continue;
          sums.set(b.materialId, (sums.get(b.materialId) ?? DEC(0)).add(b.quantity));
        }
        return [...sums].map(([materialId, quantity]) => ({ materialId, _sum: { quantity } }));
      },
    },
    material: {
      findMany: async ({ where }: { where?: { id?: { in: string[] }; active?: boolean; category?: string } } = {}) => {
        let list = db.materials.slice();
        if (where?.id?.in) list = list.filter((m) => where.id!.in.includes(m.id));
        if (where?.active !== undefined) list = list.filter((m) => m.active === where.active);
        if (where?.category) list = list.filter((m) => m.category === where.category);
        return list;
      },
    },
    location: {
      findMany: async ({ where }: { where?: { id: { in: string[] } } } = {}) => {
        let list = db.locations.slice();
        if (where?.id?.in) list = list.filter((l) => where.id.in.includes(l.id));
        return list;
      },
    },
    inventoryTransaction: {
      findMany: async ({ where, take }: { where?: Record<string, unknown>; take?: number } = {}) => {
        let list = db.transactions.slice();
        const w = where as { materialId?: string; type?: string | { in: string[] }; projectNumber?: string; postedAt?: { gte?: Date; lte?: Date } } | undefined;
        if (w?.materialId) list = list.filter((t) => t.materialId === w.materialId);
        if (w?.type) {
          const types = typeof w.type === 'string' ? [w.type] : w.type.in;
          list = list.filter((t) => types.includes(t.type));
        }
        if (w?.projectNumber) list = list.filter((t) => t.projectNumber === w.projectNumber);
        if (w?.postedAt) {
          if (w.postedAt.gte) list = list.filter((t) => t.postedAt >= w.postedAt!.gte!);
          if (w.postedAt.lte) list = list.filter((t) => t.postedAt <= w.postedAt!.lte!);
        }
        list.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
        if (take) list = list.slice(0, take);
        return list.map((t) => {
          const m = db.materials.find((x) => x.id === t.materialId);
          const l = db.locations.find((x) => x.id === t.locationId);
          return {
            ...t,
            material: { sku: m?.sku ?? 'SKU', name: m?.name ?? 'Mat', category: m?.category ?? 'C', unitOfMeasure: m?.unitOfMeasure ?? 'each' },
            location: { name: l?.name ?? 'Loc' },
            actor: { id: t.actorId, name: 'Actor', email: 'actor@test' },
          };
        });
      },
    },
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => db.settings.get(where.key) ?? null,
    },
    goodsReceiptLine: {
      findMany: async ({ where }: { where: { materialId: { in: string[] }; goodsReceipt: { status: string } } }) => db.receipts
        .filter((r) => where.materialId.in.includes(r.materialId) && r.status === where.goodsReceipt.status)
        .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
        .map((r) => ({ materialId: r.materialId, goodsReceipt: { receivedAt: r.receivedAt, supplier: { name: r.supplier } } })),
    },
  };
}

beforeEach(() => {
  db.balances = [];
  db.materials = [];
  db.locations = [];
  db.transactions = [];
  db.receipts = [];
  db.settings.clear();
});

describe('ReportingService', () => {
  function seedMaterials() {
    db.materials = [
      { id: 'm-1', sku: 'SKU-001', name: 'Bolt M8', category: 'FASTENERS', unitOfMeasure: 'PCS', requiredStock: DEC(10), unitCost: DEC(5), active: true },
      { id: 'm-2', sku: 'SKU-002', name: 'Cable 1mm', category: 'ELECTRICAL', unitOfMeasure: 'MTR', requiredStock: DEC(50), unitCost: DEC(10), active: true },
      { id: 'm-3', sku: 'SKU-003', name: 'Paint Red', category: 'CONSUMABLES', unitOfMeasure: 'LTR', requiredStock: DEC(25), unitCost: DEC(20), active: true },
    ];
    db.locations = [
      { id: 'l-1', name: 'Main Storeroom', type: 'STOREROOM', active: true },
      { id: 'l-2', name: 'Boiler Shop', type: 'SHOP_FLOOR_AREA', active: true },
    ];
  }

  describe('currentStock', () => {
    it('returns an empty array when there are no balances', async () => {
      seedMaterials();
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock();
      expect(result).toEqual([]);
    });

    it('returns enriched rows with the correct shape', async () => {
      seedMaterials();
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(20), updatedAt: new Date() },
        { materialId: 'm-2', locationId: 'l-2', quantity: DEC(30), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock();
      expect(result).toHaveLength(2);
      const first = result[0]!;
      expect(first.materialSku).toBe('SKU-001');
      expect(first.materialName).toBe('Bolt M8');
      expect(first.locationName).toBe('Main Storeroom');
      expect(first.quantity).toBe('20');
      expect(first.requiredStock).toBe('10');
    });

    it('marks items needing re-order (URGENT or WARNING) when alerts are enabled (default)', async () => {
      seedMaterials();
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(5), updatedAt: new Date() },
        { materialId: 'm-2', locationId: 'l-1', quantity: DEC(100), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock();
      const below = result.find((r) => r.materialId === 'm-1');
      expect(below).toMatchObject({ belowThreshold: false, stockStatus: 'OK', percentOfRequired: 50 });
      const above = result.find((r) => r.materialId === 'm-2');
      expect(above).toMatchObject({ belowThreshold: false, stockStatus: 'OK', percentOfRequired: 200 });
      db.balances = [{ materialId: 'm-1', locationId: 'l-1', quantity: DEC(1), updatedAt: new Date() }];
      expect((await ReportingService.currentStock())[0]).toMatchObject({ belowThreshold: true, stockStatus: 'URGENT', percentOfRequired: 10 });
    });

    it('never marks anything below threshold when enableStockAlerts is off', async () => {
      seedMaterials();
      db.settings.set('inventory.enableStockAlerts', { value: false });
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(0), updatedAt: new Date() },
        { materialId: 'm-3', locationId: 'l-2', quantity: DEC(1), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock();
      expect(result.every((r) => r.belowThreshold === false && r.stockStatus === null)).toBe(true);
    });

    it('judges each row by the item\'s total across locations', async () => {
      seedMaterials();
      // Bolt: required 10; 1 + 3 = 4 on hand in all = 40% → OK, though each row alone is below 40%.
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(1), updatedAt: new Date() },
        { materialId: 'm-1', locationId: 'l-2', quantity: DEC(3), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock();
      expect(result.map((r) => [r.locationId, r.stockStatus, r.requiredStock])).toEqual([['l-1', 'OK', '10'], ['l-2', 'OK', '10']]);
    });

    it('filters by locationId', async () => {
      seedMaterials();
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(20), updatedAt: new Date() },
        { materialId: 'm-1', locationId: 'l-2', quantity: DEC(20), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock({ locationId: 'l-2' });
      expect(result).toHaveLength(1);
      expect(result[0]!.locationId).toBe('l-2');
    });

    it('filters by materialId', async () => {
      seedMaterials();
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(20), updatedAt: new Date() },
        { materialId: 'm-2', locationId: 'l-1', quantity: DEC(30), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock({ materialId: 'm-1' });
      expect(result).toHaveLength(1);
      expect(result[0]!.materialId).toBe('m-1');
    });
  });

  describe('stockStatus', () => {
    it('grades every active item by on hand as a share of Required Stock, most urgent first', async () => {
      seedMaterials();
      db.materials.push(
        { id: 'm-4', sku: 'SKU-004', name: 'Tape', category: 'CONSUMABLES', unitOfMeasure: 'roll', requiredStock: DEC(0), unitCost: null, active: true },
        { id: 'm-5', sku: 'SKU-005', name: 'Old part', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: DEC(10), unitCost: null, active: false },
      );
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(1), updatedAt: new Date() }, // 10% of 10
        { materialId: 'm-1', locationId: 'l-2', quantity: DEC(0.9), updatedAt: new Date() }, // 19% in all → URGENT
        { materialId: 'm-2', locationId: 'l-1', quantity: DEC(10), updatedAt: new Date() }, // 20% of 50 → WARNING
        { materialId: 'm-3', locationId: 'l-1', quantity: DEC(10), updatedAt: new Date() }, // 40% of 25 → OK
        { materialId: 'm-4', locationId: 'l-1', quantity: DEC(7), updatedAt: new Date() }, // no Required Stock
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const rows = await ReportingService.stockStatus();
      expect(rows.map((r) => [r.sku, r.status, r.percentOfRequired, r.onHand, r.reorderQuantity])).toEqual([
        ['SKU-001', 'URGENT', 19, '1.9', '8.1'],
        ['SKU-002', 'WARNING', 20, '10', '40'],
        ['SKU-003', 'OK', 40, '10', '15'],
        ['SKU-004', 'NOT_SET', null, '7', '0'],
      ]);
      expect(rows[0]!.locations).toEqual([
        { locationId: 'l-2', locationName: 'Boiler Shop', quantity: '0.9' },
        { locationId: 'l-1', locationName: 'Main Storeroom', quantity: '1' },
      ]);
    });

    it('lists an item with no stock anywhere as URGENT', async () => {
      seedMaterials();
      const { ReportingService } = await import('./reporting.service.js');
      const rows = await ReportingService.stockStatus({ status: ['URGENT'] });
      expect(rows.map((r) => [r.sku, r.onHand, r.percentOfRequired])).toEqual([['SKU-001', '0', 0], ['SKU-002', '0', 0], ['SKU-003', '0', 0]]);
    });

    it('uses the bands from settings', async () => {
      seedMaterials();
      db.settings.set('inventory.urgentBelowPercent', { value: 10 });
      db.settings.set('inventory.warningBelowPercent', { value: 60 });
      db.balances = [{ materialId: 'm-1', locationId: 'l-1', quantity: DEC(5), updatedAt: new Date() }];
      const { ReportingService } = await import('./reporting.service.js');
      const rows = await ReportingService.stockStatus({ status: ['WARNING'] });
      expect(rows.map((r) => r.sku)).toContain('SKU-001');
    });

    it('names the supplier of the latest posted goods receipt', async () => {
      seedMaterials();
      db.receipts = [
        { materialId: 'm-1', receivedAt: new Date('2026-08-01'), supplier: 'Old Supplier', status: 'POSTED' },
        { materialId: 'm-1', receivedAt: new Date('2026-09-18'), supplier: 'Hydroscand', status: 'POSTED' },
        { materialId: 'm-1', receivedAt: new Date('2026-10-01'), supplier: 'Draft Only', status: 'DRAFT' },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const rows = await ReportingService.stockStatus();
      expect(rows.find((r) => r.sku === 'SKU-001')?.lastSupplier).toEqual({ name: 'Hydroscand', receivedAt: '2026-09-18T00:00:00.000Z' });
      expect(rows.find((r) => r.sku === 'SKU-002')?.lastSupplier).toBeNull();
    });

    it('filters by category', async () => {
      seedMaterials();
      const { ReportingService } = await import('./reporting.service.js');
      expect((await ReportingService.stockStatus({ category: 'ELECTRICAL' })).map((r) => r.sku)).toEqual(['SKU-002']);
    });
  });

  describe('lowStock', () => {
    it('returns an empty array when enableStockAlerts is off', async () => {
      seedMaterials();
      db.settings.set('inventory.enableStockAlerts', { value: false });
      const { ReportingService } = await import('./reporting.service.js');
      expect(await ReportingService.lowStock()).toEqual([]);
    });

    it('returns the items that are URGENT or WARNING', async () => {
      seedMaterials();
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(3), updatedAt: new Date() }, // 30% → WARNING
        { materialId: 'm-2', locationId: 'l-1', quantity: DEC(100), updatedAt: new Date() }, // 200% → OK
        { materialId: 'm-3', locationId: 'l-1', quantity: DEC(0), updatedAt: new Date() }, // 0% → URGENT
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.lowStock();
      expect(result.map((r) => [r.sku, r.status, r.onHand, r.requiredStock])).toEqual([
        ['SKU-003', 'URGENT', '0', '25'], ['SKU-001', 'WARNING', '3', '10'],
      ]);
    });
  });

  describe('movementHistory', () => {
    it('returns enriched movement rows ordered by postedAt descending', async () => {
      seedMaterials();
      db.transactions = [
        { id: 't-1', postedAt: new Date('2026-09-01'), type: 'RECEIPT', materialId: 'm-1', locationId: 'l-1', quantity: DEC(100), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: null, referenceType: null, referenceId: null },
        { id: 't-2', postedAt: new Date('2026-09-05'), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(-30), actorId: 'u-2', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'AFRI-1325', referenceType: 'Project', referenceId: 'AFRI-1325' },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.movementHistory();
      expect(result).toHaveLength(2);
      expect(result[0]!.postedAt).toBe('2026-09-05T00:00:00.000Z');
      expect(result[0]!.type).toBe('ISSUE');
      expect(result[0]!.quantity).toBe('-30');
      expect(result[0]!.materialSku).toBe('SKU-001');
      expect(result[0]!.locationName).toBe('Main Storeroom');
      expect(result[0]!.projectNumber).toBe('AFRI-1325');
    });

    it('filters by type', async () => {
      seedMaterials();
      db.transactions = [
        { id: 't-1', postedAt: new Date(), type: 'RECEIPT', materialId: 'm-1', locationId: 'l-1', quantity: DEC(100), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: null, referenceType: null, referenceId: null },
        { id: 't-2', postedAt: new Date(), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(-30), actorId: 'u-2', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: null, referenceType: null, referenceId: null },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.movementHistory({ type: 'ISSUE' });
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('ISSUE');
    });

    it('filters by projectNumber', async () => {
      seedMaterials();
      db.transactions = [
        { id: 't-1', postedAt: new Date(), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(-10), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-A', referenceType: null, referenceId: null },
        { id: 't-2', postedAt: new Date(), type: 'ISSUE', materialId: 'm-2', locationId: 'l-1', quantity: DEC(-20), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-B', referenceType: null, referenceId: null },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.movementHistory({ projectNumber: 'P-A' });
      expect(result).toHaveLength(1);
      expect(result[0]!.projectNumber).toBe('P-A');
    });

    it('caps the page size at 1000', async () => {
      seedMaterials();
      for (let i = 0; i < 1200; i++) {
        db.transactions.push({
          id: `t-${i}`, postedAt: new Date(`2026-01-${String(i % 28 + 1).padStart(2, '0')}`),
          type: 'RECEIPT', materialId: 'm-1', locationId: 'l-1', quantity: DEC(1), actorId: 'u-1',
          recipientId: null, reasonCode: null, reasonNote: null, projectNumber: null, referenceType: null, referenceId: null,
        });
      }
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.movementHistory({ limit: 2000 });
      expect(result).toHaveLength(1000);
    });
  });

  describe('projectConsumption', () => {
    it('nets fractional reversals only within the requested project', async () => {
      seedMaterials();
      const base: Tx = {
        id: 'original', postedAt: new Date('2026-09-01'), type: 'ISSUE', materialId: 'm-1',
        locationId: 'l-1', quantity: DEC(-0.375), actorId: 'u-1', recipientId: null,
        reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: null, referenceId: null,
      };
      db.transactions = [
        base,
        { ...base, id: 'reversal', quantity: DEC(0.375) },
        { ...base, id: 'remaining', quantity: DEC(-0.125) },
        { ...base, id: 'other-project', quantity: DEC(-10), projectNumber: 'P-2' },
        { ...base, id: 'receipt', quantity: DEC(100), type: 'RECEIPT' },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      expect(await ReportingService.projectConsumption('P-1')).toEqual([
        expect.objectContaining({ materialId: 'm-1', total: 0.125 }),
      ]);
      expect(await ReportingService.projectConsumption('P-2')).toEqual([
        expect.objectContaining({ materialId: 'm-1', total: 10 }),
      ]);
    });

    it('aggregates issued quantities per material', async () => {
      seedMaterials();
      db.transactions = [
        { id: 't-1', postedAt: new Date(), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(-10), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: null, referenceId: null },
        { id: 't-2', postedAt: new Date(), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(-5), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: null, referenceId: null },
        { id: 't-3', postedAt: new Date(), type: 'RECEIPT', materialId: 'm-1', locationId: 'l-1', quantity: DEC(100), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: null, referenceId: null },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.projectConsumption('P-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.materialId).toBe('m-1');
      expect(result[0]!.materialSku).toBe('SKU-001');
      expect(result[0]!.total).toBe(15);
    });

    it('nets reversed issues out of the total, dropping fully reversed materials', async () => {
      seedMaterials();
      db.transactions = [
        { id: 't-1', postedAt: new Date(), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(-10), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: null, referenceId: null },
        { id: 't-2', postedAt: new Date(), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(-5), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: null, referenceId: null },
        { id: 't-3', postedAt: new Date(), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(5), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: 'Wrong item', projectNumber: 'P-1', referenceType: null, referenceId: null },
        { id: 't-4', postedAt: new Date(), type: 'ISSUE', materialId: 'm-2', locationId: 'l-1', quantity: DEC(-3), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: null, referenceId: null },
        { id: 't-5', postedAt: new Date(), type: 'ISSUE', materialId: 'm-2', locationId: 'l-1', quantity: DEC(3), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: 'Wrong project', projectNumber: 'P-1', referenceType: null, referenceId: null },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.projectConsumption('P-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.materialId).toBe('m-1');
      expect(result[0]!.total).toBe(10);
    });

    it('nets returned stock out of the project total', async () => {
      seedMaterials();
      db.transactions = [
        { id: 't-1', postedAt: new Date(), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: DEC(-10), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: 'Project', referenceId: 'P-1' },
        { id: 't-2', postedAt: new Date(), type: 'RETURN', materialId: 'm-1', locationId: 'l-1', quantity: DEC(4), actorId: 'u-1', recipientId: null, reasonNote: 'Unused', reasonCode: null, projectNumber: 'P-1', referenceType: 'Return', referenceId: 't-1' },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.projectConsumption('P-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.total).toBe(6);
    });

    it('returns an empty array when no issues exist for the project', async () => {
      seedMaterials();
      db.transactions = [
        { id: 't-1', postedAt: new Date(), type: 'RECEIPT', materialId: 'm-1', locationId: 'l-1', quantity: DEC(100), actorId: 'u-1', recipientId: null, reasonCode: null, reasonNote: null, projectNumber: 'P-1', referenceType: null, referenceId: null },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.projectConsumption('P-1');
      expect(result).toEqual([]);
    });

    it('includes materials with zero consumption when they only have receipts', async () => {
      seedMaterials();
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.projectConsumption('NONEXISTENT');
      expect(result).toEqual([]);
    });
  });
});
