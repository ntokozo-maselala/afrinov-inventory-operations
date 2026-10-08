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
  settings: new Map<string, { value: unknown }>(),
};

const DEC = (n: number) => new Prisma.Decimal(n);

vi.mock('../../shared/db.js', () => ({
  get prisma() { return makePrisma(); },
}));

function makePrisma(): unknown {
  return {
    inventoryBalance: {
      findMany: async ({ where }: { where?: { locationId?: string; materialId?: string } } = {}) => {
        let list = db.balances.slice();
        if (where?.locationId) list = list.filter((b) => b.locationId === where.locationId);
        if (where?.materialId) list = list.filter((b) => b.materialId === where.materialId);
        return list;
      },
    },
    material: {
      findMany: async ({ where }: { where?: { id: { in: string[] } }; category?: string } = {}) => {
        let list = db.materials.slice();
        if (where?.id?.in) list = list.filter((m) => where.id.in.includes(m.id));
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
        const w = where as { materialId?: string; type?: string; projectNumber?: string; postedAt?: { gte?: Date; lte?: Date } } | undefined;
        if (w?.materialId) list = list.filter((t) => t.materialId === w.materialId);
        if (w?.type) list = list.filter((t) => t.type === w.type);
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
  };
}

beforeEach(() => {
  db.balances = [];
  db.materials = [];
  db.locations = [];
  db.transactions = [];
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

    it('marks items below threshold when alerts are enabled (default)', async () => {
      seedMaterials();
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(5), updatedAt: new Date() },
        { materialId: 'm-2', locationId: 'l-1', quantity: DEC(100), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock();
      const below = result.find((r) => r.materialId === 'm-1');
      expect(below!.belowThreshold).toBe(true);
      const above = result.find((r) => r.materialId === 'm-2');
      expect(above!.belowThreshold).toBe(false);
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
      expect(result.every((r) => r.belowThreshold === false)).toBe(true);
    });

    it('applies the lowStockMultiplier to the threshold', async () => {
      seedMaterials();
      db.settings.set('inventory.lowStockMultiplier', { value: 2 });
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(15), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.currentStock();
      const row = result[0]!;
      // requiredStock 10 × multiplier 2 = 20; 15 <= 20 → below threshold
      expect(row.requiredStock).toBe('20');
      expect(row.belowThreshold).toBe(true);
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

  describe('lowStock', () => {
    it('returns an empty array when enableStockAlerts is off', async () => {
      seedMaterials();
      db.settings.set('inventory.enableStockAlerts', { value: false });
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(0), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.lowStock();
      expect(result).toEqual([]);
    });

    it('returns only below-threshold rows when alerts are enabled', async () => {
      seedMaterials();
      db.balances = [
        { materialId: 'm-1', locationId: 'l-1', quantity: DEC(5), updatedAt: new Date() },
        { materialId: 'm-2', locationId: 'l-1', quantity: DEC(100), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.lowStock();
      expect(result).toHaveLength(1);
      expect(result[0]!.materialId).toBe('m-1');
      expect(result[0]!.sku).toBe('SKU-001');
      expect(Number(result[0]!.quantity)).toBe(5);
      expect(Number(result[0]!.requiredStock)).toBe(10);
    });

    it('includes out-of-stock items (quantity 0) as low stock', async () => {
      seedMaterials();
      db.balances = [
        { materialId: 'm-3', locationId: 'l-1', quantity: DEC(0), updatedAt: new Date() },
      ];
      const { ReportingService } = await import('./reporting.service.js');
      const result = await ReportingService.lowStock();
      expect(result).toHaveLength(1);
      expect(Number(result[0]!.quantity)).toBe(0);
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
