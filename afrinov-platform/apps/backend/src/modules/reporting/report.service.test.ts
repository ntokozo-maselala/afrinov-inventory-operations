// Unit tests for the inventory report service.
//
// We test the report builder with a stub Prisma client injected via
// vi.mock. This keeps the tests fast, deterministic, and independent of a
// real PostgreSQL instance. The tests focus on the data contracts:
//   - status classification
//   - KPI math
//   - breakdown grouping
//   - exception ordering
//   - filter propagation
//   - export generation
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each test sets `__stubState` to a fresh State; the hoisted mock below
// reads it and dispatches the appropriate fake response.
const __stubState: { current: State | null } = { current: null };

beforeEach(() => {
  __stubState.current = null;
});

vi.mock('../../shared/db.js', () => ({
  get prisma() {
    if (!__stubState.current) throw new Error('Stub prisma not initialised for this test');
    return makePrismaStub(__stubState.current);
  },
}));

// Import the SUT after the mock is in place. The import is module-level so
// it picks up the vi.mock at hoist time.
import { ReportService } from './report.service.js';
import { buildInventoryXlsx, buildInventoryPdf } from './report-export.js';

type Category = 'FASTENERS_SLUGS_INSULATION' | 'TOOLING_PPE_ELECTRICAL' | 'PROJECT_MATERIAL' | 'CONSUMABLES' | 'TOOLS';

interface MatWhere {
  active?: boolean;
  id?: { in: string[] };
  category?: { in: Category[] };
  OR?: Array<{ sku?: { contains: string }; name?: { contains: string } }>;
}
interface BalWhere { locationId?: { in: string[] } }
interface TxWhere {
  materialId?: { in: string[] };
  postedAt?: { gte?: Date; lt?: Date };
  type?: Tx['type'];
}
interface POLWhere {
  materialId?: { in: string[] };
  purchaseOrder?: { supplierId?: { in: string[] } };
}

interface FakeDecimal { toNumber(): number; toString(): string }
const dec = (n: number): FakeDecimal => ({ toNumber: () => n, toString: () => String(n) });

interface Mat { id: string; sku: string; name: string; description: string | null; category: Category; unitOfMeasure: string; unitCost: FakeDecimal | null; requiredStock: FakeDecimal; active: boolean; updatedAt: Date }
interface Bal { materialId: string; locationId: string; quantity: FakeDecimal; updatedAt: Date }
interface Loc { id: string; name: string; type: string; active: boolean }
interface Sup { id: string; name: string; active: boolean }
interface PO { id: string; number: string; supplierId: string; status: string; createdById: string; createdAt: Date; updatedAt: Date; notes?: string | null }
interface POL { id: string; purchaseOrderId: string; materialId: string; orderedQty: FakeDecimal; receivedQty: FakeDecimal }
interface Tx { id: string; postedAt: Date; type: 'RECEIPT' | 'ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT'; materialId: string; locationId: string; quantity: FakeDecimal; referenceType?: string | null; referenceId?: string | null; recipientId?: string | null; reasonCode?: 'COUNT_VARIANCE' | 'DAMAGE' | 'LOSS' | 'SCRAP' | 'OTHER' | null; reasonNote?: string | null; projectNumber?: string | null; actorId: string; pairedWithId?: string | null; reversesId?: string | null }

interface State {
  materials: Mat[];
  balances: Bal[];
  locations: Loc[];
  suppliers: Sup[];
  purchaseOrders: PO[];
  purchaseOrderLines: POL[];
  transactions: Tx[];
  users: { id: string; name: string; email: string }[];
}

function makePrismaStub(s: State) {
  return {
    material: {
      findMany: async ({ where }: { where?: MatWhere } = {}) => {
        let list = s.materials.slice();
        if (where) {
          if (where.active !== undefined) list = list.filter((m) => m.active === where.active);
          if (where.id?.in) list = list.filter((m) => where.id!.in!.includes(m.id));
          if (where.category?.in) list = list.filter((m) => where.category!.in!.includes(m.category));
          if (where.OR) {
            list = list.filter((m) =>
              where.OR!.some((c) =>
                (c.sku?.contains && m.sku.toLowerCase().includes(String(c.sku.contains).toLowerCase())) ||
                (c.name?.contains && m.name.toLowerCase().includes(String(c.name.contains).toLowerCase())),
              ),
            );
          }
        }
        return list;
      },
    },
    inventoryBalance: {
      findMany: async ({ where }: { where?: BalWhere } = {}) => {
        let list = s.balances.slice();
        if (where?.locationId?.in) list = list.filter((b) => where.locationId!.in!.includes(b.locationId));
        return list;
      },
    },
    inventoryTransaction: {
      groupBy: async ({ where }: { where: TxWhere }) => {
        const set = new Map<string, Date>();
        const ids = where.materialId?.in ?? [];
        for (const t of s.transactions) {
          if (!ids.includes(t.materialId)) continue;
          const cur = set.get(t.materialId);
          if (!cur || t.postedAt > cur) set.set(t.materialId, t.postedAt);
        }
        return Array.from(set.entries()).map(([materialId, postedAt]) => ({
          materialId,
          _max: { postedAt },
        }));
      },
      findMany: async ({ where, take }: { where?: TxWhere; take?: number }) => {
        let list = s.transactions.slice();
        if (where?.materialId?.in) {
          const ids = where.materialId.in;
          list = list.filter((t) => ids.includes(t.materialId));
        }
        const postedAt = where?.postedAt;
        if (postedAt) {
          if (postedAt.gte) list = list.filter((t) => t.postedAt >= postedAt.gte!);
          if (postedAt.lt) list = list.filter((t) => t.postedAt < postedAt.lt!);
        }
        if (where?.type) list = list.filter((t) => t.type === where.type);
        list.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
        if (take) list = list.slice(0, take);
        return list.map((t) => {
          const m = s.materials.find((x) => x.id === t.materialId)!;
          const l = s.locations.find((x) => x.id === t.locationId)!;
          return {
            ...t,
            material: { sku: m.sku, name: m.name, category: m.category },
            location: { id: l.id, name: l.name },
            actor: { name: 'Test User' },
            reversedBy: s.transactions.find((r) => r.reversesId === t.id) ?? null,
          };
        });
      },
    },
    location: { findMany: async () => s.locations.filter((l) => l.active) },
    supplier: {
      findUnique: async ({ where }: { where: { id: string } }) => s.suppliers.find((x) => x.id === where.id) ?? null,
    },
    purchaseOrderLine: {
      findMany: async ({ where }: { where?: POLWhere } = {}) => {
        let list = s.purchaseOrderLines.slice();
        if (where?.materialId?.in) list = list.filter((l) => where.materialId!.in!.includes(l.materialId));
        if (where?.purchaseOrder?.supplierId?.in) {
          const supIds = where.purchaseOrder.supplierId.in;
          list = list.filter((l) => {
            const po = s.purchaseOrders.find((p) => p.id === l.purchaseOrderId);
            return po && supIds.includes(po.supplierId);
          });
        }
        return list.map((l) => {
          const po = s.purchaseOrders.find((p) => p.id === l.purchaseOrderId)!;
          return {
            materialId: l.materialId,
            purchaseOrder: { supplierId: po?.supplierId, supplier: s.suppliers.find((sp) => sp.id === po?.supplierId) ?? null },
          };
        });
      },
    },
  };
}

function makeMat(id: string, sku: string, name: string, requiredStock: number, unitCost: number | null, category: Category = 'CONSUMABLES'): Mat {
  return { id, sku, name, description: null, category, unitOfMeasure: 'each', unitCost: unitCost === null ? null : dec(unitCost), requiredStock: dec(requiredStock), active: true, updatedAt: new Date('2026-01-01') };
}
function makeBal(materialId: string, locationId: string, qty: number): Bal {
  return { materialId, locationId, quantity: dec(qty), updatedAt: new Date('2026-01-01') };
}
function makeLoc(id: string, name: string): Loc { return { id, name, type: 'STOREROOM', active: true }; }
function makeSup(id: string, name: string): Sup { return { id, name, active: true }; }

const baseQuery = {
  range: 'ALL' as const,
  category: [],
  locationId: [],
  supplierId: [],
  materialId: [],
  stockStatus: 'ALL' as const,
  itemStatus: 'ACTIVE' as const,
  page: 1,
  pageSize: 200,
};

describe('parseReportQuery', () => {
  it('rejects invalid custom date range', async () => {
    const { parseReportQuery } = await import('./report-query.schema.js');
    expect(() =>
      parseReportQuery({ range: 'CUSTOM', from: '2026-09-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' }),
    ).toThrow();
    expect(() => parseReportQuery({ range: 'CUSTOM' })).toThrow();
    const ok = parseReportQuery({ range: 'MONTH' });
    expect(ok.range).toBe('MONTH');
  });

  it('normalises repeated and comma-separated query values', async () => {
    const { parseReportQuery } = await import('./report-query.schema.js');
    const a = parseReportQuery({ category: ['CONSUMABLES', 'TOOLS'] });
    expect(a.category).toEqual(['CONSUMABLES', 'TOOLS']);
    const b = parseReportQuery({ category: 'CONSUMABLES,TOOLS' });
    expect(b.category).toEqual(['CONSUMABLES', 'TOOLS']);
  });
});

describe('resolveDateWindow', () => {
  it('returns nulls for ALL', async () => {
    const { resolveDateWindow, parseReportQuery } = await import('./report-query.schema.js');
    const q = parseReportQuery({ range: 'ALL' });
    const w = resolveDateWindow(q, new Date('2026-09-02T12:00:00Z'));
    expect(w.from).toBeNull();
    expect(w.to).toBeNull();
  });

  it('resolves month window', async () => {
    const { resolveDateWindow, parseReportQuery } = await import('./report-query.schema.js');
    const q = parseReportQuery({ range: 'MONTH' });
    const w = resolveDateWindow(q, new Date('2026-09-02T12:00:00Z'));
    expect(w.from?.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(w.to?.toISOString().slice(0, 10)).toBe('2026-10-01');
  });
});

describe('ReportService.inventory', () => {
  it('classifies stock status correctly', async () => {
    __stubState.current = {
      materials: [
        makeMat('m-ok', 'A-1', 'A', 10, 1),
        makeMat('m-low', 'A-2', 'B', 100, 1),
        makeMat('m-out', 'A-3', 'C', 50, 1),
      ],
      balances: [makeBal('m-ok', 'l-1', 100), makeBal('m-low', 'l-1', 50), makeBal('m-out', 'l-1', 0)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    expect(r.kpis.skuCount).toBe(3);
    const byStatus = Object.fromEntries(r.byStatus.map((s) => [s.status, s.skuCount]));
    expect(byStatus['IN_STOCK']).toBe(1);
    expect(byStatus['LOW_STOCK']).toBe(1);
    expect(byStatus['OUT_OF_STOCK']).toBe(1);
  });

  it('computes KPIs and respects category filter', async () => {
    __stubState.current = {
      materials: [
        makeMat('m-1', 'A-1', 'A', 5, 10, 'FASTENERS_SLUGS_INSULATION'),
        makeMat('m-2', 'B-1', 'B', 5, 20, 'CONSUMABLES'),
      ],
      balances: [makeBal('m-1', 'l-1', 50), makeBal('m-2', 'l-1', 25)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const all = await ReportService.inventory(baseQuery);
    expect(all.kpis.skuCount).toBe(2);
    expect(all.kpis.totalQuantity).toBe(75);
    // value: 50*10 + 25*20 = 1000
    expect(all.kpis.inventoryValue).toBeCloseTo(1000);
    const r = await ReportService.inventory({ ...baseQuery, category: ['FASTENERS_SLUGS_INSULATION'] });
    expect(r.kpis.skuCount).toBe(1);
    expect(r.kpis.inventoryValue).toBeCloseTo(500);
  });

  it('groups by category with value share', async () => {
    __stubState.current = {
      materials: [
        makeMat('m-1', 'A-1', 'A', 0, 100, 'FASTENERS_SLUGS_INSULATION'),
        makeMat('m-2', 'B-1', 'B', 0, 200, 'CONSUMABLES'),
      ],
      balances: [makeBal('m-1', 'l-1', 10), makeBal('m-2', 'l-1', 10)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    expect(r.byCategory[0]!.category).toBe('CONSUMABLES');
    expect(r.byCategory[0]!.share).toBeCloseTo(2 / 3);
    expect(r.byCategory[1]!.share).toBeCloseTo(1 / 3);
  });

  it('returns exceptions ordered by severity', async () => {
    __stubState.current = {
      materials: [
        makeMat('m-low-1', 'A-1', 'A', 10, 1),
        makeMat('m-low-2', 'A-2', 'A', 10, 1),
        makeMat('m-out-1', 'A-3', 'A', 0, 1),
        makeMat('m-ok', 'A-4', 'A', 10, 1),
      ],
      balances: [
        makeBal('m-low-1', 'l-1', 5),
        makeBal('m-low-2', 'l-1', 9),
        makeBal('m-out-1', 'l-1', 0),
        makeBal('m-ok', 'l-1', 200),
      ],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    expect(r.exceptions.length).toBe(3);
    expect(r.exceptions[0]!.status).toBe('OUT_OF_STOCK');
    expect(r.exceptions[1]!.quantity).toBe(5);
    expect(r.exceptions[2]!.quantity).toBe(9);
  });

  it('honours stock status filter', async () => {
    __stubState.current = {
      materials: [makeMat('m-ok', 'A-1', 'A', 0, 10), makeMat('m-low', 'A-2', 'A', 0, 10), makeMat('m-out', 'A-3', 'A', 0, 10)],
      balances: [makeBal('m-ok', 'l-1', 50), makeBal('m-low', 'l-1', 5), makeBal('m-out', 'l-1', 0)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, stockStatus: 'OUT_OF_STOCK' });
    expect(r.inventory.every((l) => l.status === 'OUT_OF_STOCK')).toBe(true);
    expect(r.kpis.outOfStockCount).toBe(1);
  });

  it('counts suppliers via PO history', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 5, 10)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [makeSup('s-1', 'Hydroscand')],
      purchaseOrders: [{ id: 'po-1', number: 'PO-1', supplierId: 's-1', status: 'APPROVED', createdById: 'u-1', createdAt: new Date(), updatedAt: new Date() }],
      purchaseOrderLines: [{ id: 'pol-1', purchaseOrderId: 'po-1', materialId: 'm-1', orderedQty: dec(100), receivedQty: dec(0) }],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    expect(r.kpis.supplierCount).toBe(1);
    expect(r.bySupplier.length).toBe(1);
    expect(r.bySupplier[0]!.supplierName).toBe('Hydroscand');
  });

  it('summarises movements by type', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 0, 1)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [
        { id: 't-1', postedAt: new Date('2026-09-01'), type: 'RECEIPT', materialId: 'm-1', locationId: 'l-1', quantity: dec(50), actorId: 'u-1' },
        { id: 't-2', postedAt: new Date('2026-09-01'), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: dec(-10), actorId: 'u-1' },
        { id: 't-3', postedAt: new Date('2026-09-01'), type: 'ADJUSTMENT', materialId: 'm-1', locationId: 'l-1', quantity: dec(-2), actorId: 'u-1' },
      ],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    expect(r.movementSummary.receipts.count).toBe(1);
    expect(r.movementSummary.issues.count).toBe(1);
    expect(r.movementSummary.adjustments.count).toBe(1);
    expect(r.movementSummary.total.count).toBe(3);
  });

  it('leaves a reversed movement and its reversal out of the summary, but lists both', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 0, 1)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [
        { id: 't-1', postedAt: new Date('2026-09-01'), type: 'RECEIPT', materialId: 'm-1', locationId: 'l-1', quantity: dec(50), actorId: 'u-1' },
        { id: 't-2', postedAt: new Date('2026-09-01'), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: dec(-10), actorId: 'u-1' },
        { id: 't-3', postedAt: new Date('2026-09-02'), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: dec(10), actorId: 'u-1', reversesId: 't-2' },
      ],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    expect(r.movementSummary.issues.count).toBe(0);
    expect(r.movementSummary.issues.quantity).toBe(0);
    expect(r.movementSummary.total.count).toBe(1);
    expect(r.movements).toHaveLength(3);
    expect(r.movements.find((m) => m.id === 't-2')!.reversedById).toBe('t-3');
    expect(r.movements.find((m) => m.id === 't-3')!.reversesId).toBe('t-2');
  });
});

describe('report export builders', () => {
  it('builds a valid .xlsx buffer', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 5, 10)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const fullReport = await ReportService.inventory(baseQuery);
    const buf = await buildInventoryXlsx(fullReport);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 2).toString()).toBe('PK');
  });

  it('builds a PDF with header', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 5, 10)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const fullReport = await ReportService.inventory(baseQuery);
    const buf = await buildInventoryPdf(fullReport);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('paginates the complete visible inventory page instead of truncating it', async () => {
    const materials = Array.from(
      { length: 200 },
      (_, index) => makeMat(`m-${index}`, `SKU-${String(index).padStart(3, '0')}`, `Material ${index}`, 10, 25),
    );
    __stubState.current = {
      materials,
      balances: materials.map((material) => makeBal(material.id, 'l-1', 50)),
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };

    const report = await ReportService.inventory({ ...baseQuery, pageSize: 200 });
    expect(report.inventory).toHaveLength(200);

    const buf = await buildInventoryPdf(report);
    const pageCount = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(5);
  });

  it('returns empty inventory with zeroed KPIs when no materials exist', async () => {
    __stubState.current = {
      materials: [],
      balances: [],
      locations: [],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    expect(r.kpis.skuCount).toBe(0);
    expect(r.kpis.totalQuantity).toBe(0);
    expect(r.kpis.inventoryValue).toBe(0);
    expect(r.kpis.outOfStockCount).toBe(0);
    expect(r.kpis.lowStockCount).toBe(0);
    expect(r.inventory).toHaveLength(0);
    expect(r.exceptions).toHaveLength(0);
  });

  it('includes an unassigned supplier bucket for materials with no PO history', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 0, 10)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    const unassigned = r.bySupplier.find((s) => s.supplierId === null);
    expect(unassigned).toBeDefined();
    expect(unassigned!.supplierName).toBe('Unassigned (no PO history)');
    expect(unassigned!.skuCount).toBe(1);
  });

  it('filters by locationId when specified', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 0, 10)],
      balances: [
        makeBal('m-1', 'l-1', 50),
        makeBal('m-1', 'l-2', 100),
      ],
      locations: [makeLoc('l-1', 'Main'), makeLoc('l-2', 'Secondary')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, locationId: ['l-2'] });
    expect(r.inventory).toHaveLength(1);
    expect(r.inventory[0]?.locationId).toBe('l-2');
    expect(r.kpis.totalQuantity).toBe(100);
  });

  it('filters by supplierId when specified', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 0, 10)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [makeSup('s-1', 'Acme'), makeSup('s-2', 'Beta')],
      purchaseOrders: [
        { id: 'po-1', number: 'PO-1', supplierId: 's-1', status: 'APPROVED', createdById: 'u-1', createdAt: new Date(), updatedAt: new Date() },
      ],
      purchaseOrderLines: [{ id: 'pol-1', purchaseOrderId: 'po-1', materialId: 'm-1', orderedQty: dec(100), receivedQty: dec(0) }],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, supplierId: ['s-1'] });
    expect(r.kpis.supplierCount).toBe(1);
    expect(r.bySupplier[0]?.supplierName).toBe('Acme');
  });

  it('respects itemStatus INACTIVE filter', async () => {
    __stubState.current = {
      materials: [
        makeMat('m-1', 'A-1', 'A', 0, 10),
        { ...makeMat('m-2', 'A-2', 'B', 0, 20), active: false },
      ],
      balances: [makeBal('m-1', 'l-1', 50), makeBal('m-2', 'l-1', 30)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, itemStatus: 'INACTIVE' });
    expect(r.kpis.skuCount).toBe(1);
    expect(r.inventory[0]?.materialId).toBe('m-2');
  });

  it('respects LOW_STOCK status filter in combination', async () => {
    __stubState.current = {
      materials: [
        makeMat('m-ok', 'A-1', 'A', 5, 1),
        makeMat('m-low', 'A-2', 'B', 10, 1),
        makeMat('m-out', 'A-3', 'C', 0, 1),
      ],
      balances: [
        makeBal('m-ok', 'l-1', 100),
        makeBal('m-low', 'l-1', 5),
        makeBal('m-out', 'l-1', 0),
      ],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, stockStatus: 'LOW_STOCK' });
    expect(r.inventory.every((l) => l.status === 'LOW_STOCK')).toBe(true);
    expect(r.inventory).toHaveLength(1);
  });

  it('paginates inventory results correctly', async () => {
    const materials = Array.from(
      { length: 20 },
      (_, index) => makeMat(`m-${index}`, `SKU-${String(index).padStart(3, '0')}`, `Material ${index}`, 0, 10),
    );
    __stubState.current = {
      materials,
      balances: materials.map((material) => makeBal(material.id, 'l-1', 50)),
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, page: 1, pageSize: 5 });
    expect(r.inventory).toHaveLength(5);
    expect(r.inventoryTotal).toBe(20);
  });

  it('includes movementType filter in movement queries', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 0, 1)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    // Re-set with transactions for movement filter test
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 0, 1)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [
        { id: 't-1', postedAt: new Date('2026-09-01'), type: 'RECEIPT', materialId: 'm-1', locationId: 'l-1', quantity: dec(50), referenceType: null, referenceId: null, recipientId: null, reasonCode: null, reasonNote: null, projectNumber: null, actorId: 'u-1', pairedWithId: null },
        { id: 't-2', postedAt: new Date('2026-09-01'), type: 'ISSUE', materialId: 'm-1', locationId: 'l-1', quantity: dec(-10), referenceType: null, referenceId: null, recipientId: null, reasonCode: null, reasonNote: null, projectNumber: null, actorId: 'u-1', pairedWithId: null },
      ],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, movementType: 'RECEIPT' });
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]?.type).toBe('RECEIPT');
    expect(r.movementSummary.receipts.count).toBe(1);
    expect(r.movementSummary.issues.count).toBe(0);
  });

  it('movement summary counts zero when no transactions exist', async () => {
    __stubState.current = {
      materials: [makeMat('m-1', 'A-1', 'A', 0, 1)],
      balances: [makeBal('m-1', 'l-1', 50)],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory(baseQuery);
    expect(r.movementSummary.total.count).toBe(0);
    expect(r.movementSummary.receipts.quantity).toBe(0);
  });

  it('search filter matches material SKU or name', async () => {
    __stubState.current = {
      materials: [
        makeMat('m-1', 'A-1', 'Widget Special', 0, 10),
        makeMat('m-2', 'B-1', 'Bolt Standard', 0, 20),
        makeMat('m-3', 'C-1', 'Screw Special', 0, 30),
      ],
      balances: [
        makeBal('m-1', 'l-1', 10),
        makeBal('m-2', 'l-1', 20),
        makeBal('m-3', 'l-1', 30),
      ],
      locations: [makeLoc('l-1', 'Main')],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, search: 'special' });
    expect(r.kpis.skuCount).toBe(2);
    expect(r.inventory.map((i) => i.sku)).toEqual(expect.arrayContaining(['A-1', 'C-1']));
  });

  it('rangeLabel for ALL is "All time"', async () => {
    __stubState.current = {
      materials: [],
      balances: [],
      locations: [],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({ ...baseQuery, range: 'ALL' });
    expect(r.kpis.rangeLabel).toBe('All time');
  });

  it('rangeLabel for CUSTOM shows date range', async () => {
    __stubState.current = {
      materials: [],
      balances: [],
      locations: [],
      suppliers: [],
      purchaseOrders: [],
      purchaseOrderLines: [],
      transactions: [],
      users: [],
    };
    const r = await ReportService.inventory({
      ...baseQuery,
      range: 'CUSTOM',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-30T00:00:00.000Z',
    });
    expect(r.kpis.rangeLabel).toBe('2026-09-01 → 2026-09-30');
  });
});
