// Reporting module — authoritative inventory reporting computation.
//
// All metrics use the same source-of-truth primitives as the rest of the
// system:
//   - `inventory_balance` (materialized) for "current on-hand" per location
//   - `material.requiredStock` for the low-stock threshold
//   - `material.unitCost` for valuation (treated as average unit cost;
//     no FIFO/LIFO is implemented in the system today)
//
// ADR-002 is honoured: nothing here mutates the ledger.
import { Prisma, MaterialCategory as PrismaMaterialCategory } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { resolveDateWindow, type ReportQuery } from './report-query.schema.js';

type Decimal = Prisma.Decimal;
type MaterialCategory = PrismaMaterialCategory;

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
export type ItemStatus = 'ALL' | 'ACTIVE' | 'INACTIVE';

export interface ReportInventoryLine {
  materialId: string;
  sku: string;
  name: string;
  description: string | null;
  category: MaterialCategory;
  unitOfMeasure: string;
  unitCost: number | null;
  requiredStock: number;
  active: boolean;
  locationId: string;
  locationName: string;
  locationType: string;
  quantity: number;
  inventoryValue: number;
  status: StockStatus;
  lastUpdated: string | null;
}

export interface ReportCategoryRow {
  category: MaterialCategory;
  skuCount: number;
  quantity: number;
  inventoryValue: number;
  share: number; // 0..1 of total value
}

export interface ReportLocationRow {
  locationId: string;
  locationName: string;
  locationType: string;
  quantity: number;
  inventoryValue: number;
  share: number;
}

export interface ReportSupplierRow {
  supplierId: string | null;
  supplierName: string;
  skuCount: number;
  quantity: number;
  inventoryValue: number;
  share: number;
}

export interface ReportStatusRow {
  status: StockStatus;
  skuCount: number;
  quantity: number;
  inventoryValue: number;
}

export interface ReportMovementRow {
  id: string;
  postedAt: string;
  type: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  category: MaterialCategory;
  locationId: string;
  locationName: string;
  quantity: number;
  actorName: string;
  reasonCode: string | null;
  reasonNote: string | null;
  projectNumber: string | null;
  referenceType: string | null;
  referenceId: string | null;
  // Set on a reversal (the movement it cancels) and on a reversed movement
  // (the reversal that cancels it).
  reversesId: string | null;
  reversedById: string | null;
}

export interface ReportMovementSummary {
  receipts: { count: number; quantity: number };
  issues: { count: number; quantity: number };
  transfers: { count: number; quantity: number };
  adjustments: { count: number; quantity: number };
  total: { count: number; quantity: number };
}

export interface ReportKpis {
  skuCount: number;
  totalQuantity: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  categoryCount: number;
  locationCount: number;
  supplierCount: number;
  movementCount: number;
  currency: string;
  generatedAt: string;
  rangeLabel: string;
}

export interface ReportResult {
  kpis: ReportKpis;
  byStatus: ReportStatusRow[];
  byCategory: ReportCategoryRow[];
  byLocation: ReportLocationRow[];
  bySupplier: ReportSupplierRow[];
  exceptions: ReportInventoryLine[]; // low + out of stock, sorted by severity
  movements: ReportMovementRow[];
  movementSummary: ReportMovementSummary;
  inventory: ReportInventoryLine[];
  inventoryTotal: number;
  page: number;
  pageSize: number;
  currency: string;
  generatedAt: string;
}

const CURRENCY = process.env.REPORT_CURRENCY ?? 'ZAR';

function toNum(d: Decimal | null | undefined): number {
  if (!d) return 0;
  return d.toNumber();
}

function classifyStatus(quantity: number, required: number): StockStatus {
  if (quantity <= 0) return 'OUT_OF_STOCK';
  if (quantity <= required) return 'LOW_STOCK';
  return 'IN_STOCK';
}

function safeRangeLabel(q: ReportQuery): string {
  switch (q.range) {
    case 'ALL': return 'All time';
    case 'TODAY': return 'Today';
    case 'WEEK': return 'This week';
    case 'MONTH': return 'This month';
    case 'QUARTER': return 'This quarter';
    case 'YEAR': return 'This year';
    case 'CUSTOM': {
      const f = q.from ? new Date(q.from) : null;
      const t = q.to ? new Date(q.to) : null;
      const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '?');
      return `${fmt(f)} → ${fmt(t)}`;
    }
  }
}

interface MaterialRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: MaterialCategory;
  unitOfMeasure: string;
  unitCost: Decimal | null;
  requiredStock: Decimal;
  active: boolean;
  updatedAt: Date;
}

interface BalanceRow {
  materialId: string;
  locationId: string;
  quantity: Decimal;
  updatedAt: Date;
}

async function loadMaterials(q: ReportQuery): Promise<MaterialRow[]> {
  const where: Prisma.MaterialWhereInput = {};
  if (q.itemStatus === 'ACTIVE') where.active = true;
  if (q.itemStatus === 'INACTIVE') where.active = false;
  if (q.category.length > 0) {
    where.category = { in: q.category as MaterialCategory[] };
  }
  if (q.materialId.length > 0) where.id = { in: q.materialId };
  if (q.search) {
    where.OR = [
      { sku: { contains: q.search, mode: 'insensitive' } },
      { name: { contains: q.search, mode: 'insensitive' } },
    ];
  }
  return prisma.material.findMany({ where, orderBy: [{ name: 'asc' }] });
}

async function loadBalances(q: ReportQuery): Promise<BalanceRow[]> {
  return prisma.inventoryBalance.findMany({
    where: {
      ...(q.locationId.length > 0 ? { locationId: { in: q.locationId } } : {}),
    },
  });
}

async function loadLocations(): Promise<Map<string, { id: string; name: string; type: string }>> {
  const rows = await prisma.location.findMany({ where: { active: true } });
  const m = new Map<string, { id: string; name: string; type: string }>();
  for (const r of rows) m.set(r.id, { id: r.id, name: r.name, type: r.type });
  return m;
}

// Suppliers that have any purchase order line referencing the filtered
// materials — this is the only realistic way to associate suppliers to
// materials in the current data model (Material has no supplier FK).
async function loadSuppliersForMaterials(
  materialIds: string[],
  q: ReportQuery,
): Promise<Map<string, { id: string; name: string }>> {
  if (materialIds.length === 0) return new Map();
  const where: Prisma.PurchaseOrderLineWhereInput = { materialId: { in: materialIds } };
  if (q.supplierId.length > 0) where.purchaseOrder = { supplierId: { in: q.supplierId } };
  const lines = await prisma.purchaseOrderLine.findMany({
    where,
    include: { purchaseOrder: { include: { supplier: true } } },
  });
  const m = new Map<string, { id: string; name: string }>();
  for (const l of lines) {
    const s = l.purchaseOrder.supplier;
    if (s && s.active) m.set(s.id, { id: s.id, name: s.name });
  }
  return m;
}

function buildLine(
  m: MaterialRow,
  loc: { id: string; name: string; type: string } | undefined,
  qty: number,
  lastUpdated: Date | null,
): ReportInventoryLine {
  const required = toNum(m.requiredStock);
  const status = classifyStatus(qty, required);
  const cost = m.unitCost ? toNum(m.unitCost) : null;
  const value = cost === null ? 0 : qty * cost;
  return {
    materialId: m.id,
    sku: m.sku,
    name: m.name,
    description: m.description,
    category: m.category,
    unitOfMeasure: m.unitOfMeasure,
    unitCost: cost,
    requiredStock: required,
    active: m.active,
    locationId: loc?.id ?? '',
    locationName: loc?.name ?? '—',
    locationType: loc?.type ?? '—',
    quantity: qty,
    inventoryValue: value,
    status,
    lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
  };
}

function lineValueOrZero(line: ReportInventoryLine): number {
  return line.unitCost === null ? 0 : line.inventoryValue;
}

export const ReportService = {
  /**
   * Build the full inventory report for the given query. Single-shot — the
   * dashboard, the table, and the export are all derived from this object
   * to guarantee they cannot drift.
   */
  async inventory(q: ReportQuery): Promise<ReportResult> {
    const [materials, balances, locations] = await Promise.all([
      loadMaterials(q),
      loadBalances(q),
      loadLocations(),
    ]);

    const matMap = new Map(materials.map((m) => [m.id, m]));

    const balancesByKey = new Map<string, BalanceRow>();
    const balancesByMaterial = new Map<string, BalanceRow[]>();
    for (const b of balances) {
      if (!matMap.has(b.materialId)) continue;
      balancesByKey.set(`${b.materialId}|${b.locationId}`, b);
      const arr = balancesByMaterial.get(b.materialId) ?? [];
      arr.push(b);
      balancesByMaterial.set(b.materialId, arr);
    }

    // Last update per material (across all locations).
    const lastUpdateByMaterial = new Map<string, Date>();
    const txForLastUpdate = await prisma.inventoryTransaction.groupBy({
      by: ['materialId'],
      _max: { postedAt: true },
      where: { materialId: { in: materials.map((m) => m.id) } },
    });
    for (const r of txForLastUpdate) {
      if (r._max.postedAt) lastUpdateByMaterial.set(r.materialId, r._max.postedAt);
    }

    // Build a material -> lines index so we never filter allLines by materialId again.
    const linesByMaterial = new Map<string, ReportInventoryLine[]>();

    // Initial lines: one per (material, location) where balance exists.
    const allLines: ReportInventoryLine[] = [];
    for (const m of materials) {
      const myBals = balancesByMaterial.get(m.id) ?? [];
      if (myBals.length === 0) {
        allLines.push(buildLine(m, undefined, 0, lastUpdateByMaterial.get(m.id) ?? null));
        continue;
      }
      for (const b of myBals) {
        const loc = locations.get(b.locationId);
        if (q.locationId.length > 0 && !q.locationId.includes(b.locationId)) continue;
        const line = buildLine(
          m,
          loc,
          toNum(b.quantity),
          lastUpdateByMaterial.get(m.id) ?? null,
        );
        if (q.stockStatus !== 'ALL' && line.status !== q.stockStatus) continue;
        allLines.push(line);
      }
    }

    for (const l of allLines) {
      const arr = linesByMaterial.get(l.materialId) ?? [];
      arr.push(l);
      linesByMaterial.set(l.materialId, arr);
    }

    // KPI computation
    const skuSet = new Set(allLines.map((l) => l.materialId));
    const totalQuantity = allLines.reduce((acc, l) => acc + Math.max(0, l.quantity), 0);
    const inventoryValue = allLines.reduce((acc, l) => acc + lineValueOrZero(l), 0);
    const lowStockCount = allLines.filter((l) => l.status === 'LOW_STOCK').length;
    const outOfStockCount = allLines.filter((l) => l.status === 'OUT_OF_STOCK').length;
    const categorySet = new Set(materials.map((m) => m.category));
    const locationSet = new Set(allLines.map((l) => l.locationId).filter(Boolean));

    // Suppliers: pull in suppliers that have any PO line for the filtered
    // materials. The current data model does not link Material → Supplier
    // directly, so we surface the supplier relationship via purchase orders.
    const supplierMap = await loadSuppliersForMaterials(
      Array.from(skuSet),
      q,
    );
    if (q.supplierId.length > 0) {
      for (const id of q.supplierId) {
        if (!supplierMap.has(id)) {
          const s = await prisma.supplier.findUnique({ where: { id } });
          if (s && s.active) supplierMap.set(s.id, { id: s.id, name: s.name });
        }
      }
    }
    const supplierCount = supplierMap.size;

    // Build the supplier → materials index used for the supplier breakdown.
    const supplierIds = Array.from(supplierMap.keys());
    const supplierMaterialMap = new Map<string, Set<string>>();
    if (supplierIds.length > 0 && materials.length > 0) {
      const lines = await prisma.purchaseOrderLine.findMany({
        where: {
          materialId: { in: materials.map((m) => m.id) },
          purchaseOrder: { supplierId: { in: supplierIds } },
        },
        select: { materialId: true, purchaseOrder: { select: { supplierId: true } } },
      });
      for (const l of lines) {
        if (!l.purchaseOrder?.supplierId) continue;
        const set = supplierMaterialMap.get(l.purchaseOrder.supplierId) ?? new Set<string>();
        set.add(l.materialId);
        supplierMaterialMap.set(l.purchaseOrder.supplierId, set);
      }
    }

    // Movements (filter by date window, optional movement type)
    const { from, to } = resolveDateWindow(q);
    const trxWhere: Prisma.InventoryTransactionWhereInput = {};
    if (from) trxWhere.postedAt = { gte: from };
    if (to) trxWhere.postedAt = { ...(trxWhere.postedAt as object | undefined), lt: to };
    if (q.movementType) trxWhere.type = q.movementType;
    if (materials.length > 0) trxWhere.materialId = { in: materials.map((m) => m.id) };

    const trx = await prisma.inventoryTransaction.findMany({
      where: trxWhere,
      include: {
        material: { select: { sku: true, name: true, category: true } },
        location: { select: { id: true, name: true } },
        actor: { select: { name: true } },
        reversedBy: { select: { id: true } },
      },
      orderBy: { postedAt: 'desc' },
      take: 1000,
    });

    const movements: ReportMovementRow[] = trx.map((t) => ({
      id: t.id,
      postedAt: t.postedAt.toISOString(),
      type: t.type,
      materialId: t.materialId,
      materialSku: t.material.sku,
      materialName: t.material.name,
      category: t.material.category,
      locationId: t.locationId,
      locationName: t.location.name,
      quantity: toNum(t.quantity),
      actorName: t.actor.name,
      reasonCode: t.reasonCode ?? null,
      reasonNote: t.reasonNote ?? null,
      projectNumber: t.projectNumber ?? null,
      referenceType: t.referenceType ?? null,
      referenceId: t.referenceId ?? null,
      reversesId: t.reversesId ?? null,
      reversedById: t.reversedBy?.id ?? null,
    }));

    // A reversed movement and its reversal cancel out, so the summary
    // leaves both out; they stay in the movements list.
    const effective = movements.filter((m) => !m.reversesId && !m.reversedById);
    const movementSummary: ReportMovementSummary = {
      receipts: { count: 0, quantity: 0 },
      issues: { count: 0, quantity: 0 },
      transfers: { count: 0, quantity: 0 },
      adjustments: { count: 0, quantity: 0 },
      total: { count: effective.length, quantity: effective.reduce((a, m) => a + Math.abs(m.quantity), 0) },
    };
    for (const m of effective) {
      switch (m.type) {
        case 'RECEIPT':
          movementSummary.receipts.count++;
          movementSummary.receipts.quantity += m.quantity;
          break;
        case 'ISSUE':
          movementSummary.issues.count++;
          movementSummary.issues.quantity += Math.abs(m.quantity);
          break;
        case 'TRANSFER_IN':
        case 'TRANSFER_OUT':
          movementSummary.transfers.count++;
          movementSummary.transfers.quantity += Math.abs(m.quantity);
          break;
        case 'ADJUSTMENT':
          movementSummary.adjustments.count++;
          movementSummary.adjustments.quantity += Math.abs(m.quantity);
          break;
      }
    }

    // Status breakdown
    const byStatus: ReportStatusRow[] = (['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as StockStatus[]).map((status) => {
      const filtered = allLines.filter((l) => l.status === status);
      return {
        status,
        skuCount: new Set(filtered.map((l) => l.materialId)).size,
        quantity: filtered.reduce((acc, l) => acc + Math.max(0, l.quantity), 0),
        inventoryValue: filtered.reduce((acc, l) => acc + lineValueOrZero(l), 0),
      };
    });

    // Category breakdown (deduped to distinct materials per category)
    const byCategoryMap = new Map<MaterialCategory, ReportCategoryRow>();
    const linesByCategory = new Map<MaterialCategory, ReportInventoryLine[]>();
    for (const l of allLines) {
      const arr = linesByCategory.get(l.category) ?? [];
      arr.push(l);
      linesByCategory.set(l.category, arr);
    }
    for (const m of materials) {
      const lines = linesByMaterial.get(m.id) ?? [];
      const row: ReportCategoryRow = byCategoryMap.get(m.category) ?? {
        category: m.category,
        skuCount: 0,
        quantity: 0,
        inventoryValue: 0,
        share: 0,
      };
      row.skuCount += 1;
      row.quantity += lines.reduce((acc, l) => acc + Math.max(0, l.quantity), 0);
      row.inventoryValue += lines.reduce((acc, l) => acc + lineValueOrZero(l), 0);
      byCategoryMap.set(m.category, row);
    }
    const byCategory = Array.from(byCategoryMap.values()).map((r) => ({
      ...r,
      share: inventoryValue > 0 ? r.inventoryValue / inventoryValue : 0,
    })).sort((a, b) => b.inventoryValue - a.inventoryValue);

    // Location breakdown
    const byLocationMap = new Map<string, ReportLocationRow>();
    for (const l of allLines) {
      if (!l.locationId) continue;
      const row = byLocationMap.get(l.locationId) ?? {
        locationId: l.locationId,
        locationName: l.locationName,
        locationType: l.locationType,
        quantity: 0,
        inventoryValue: 0,
        share: 0,
      };
      row.quantity += Math.max(0, l.quantity);
      row.inventoryValue += lineValueOrZero(l);
      byLocationMap.set(l.locationId, row);
    }
    const byLocation = Array.from(byLocationMap.values())
      .map((r) => ({ ...r, share: inventoryValue > 0 ? r.inventoryValue / inventoryValue : 0 }))
      .sort((a, b) => b.inventoryValue - a.inventoryValue);

    // Supplier breakdown. A material may have multiple suppliers via its
    // PO history; we attribute its value equally across the suppliers that
    // have ever supplied it (proportional share). This is intentionally
    // simple and consistent with the data model — there is no canonical
    // Material→Supplier relationship today.
    const bySupplierMap = new Map<string, ReportSupplierRow>();
    for (const [supplierId, matIds] of supplierMaterialMap.entries()) {
      const supplier = supplierMap.get(supplierId);
      if (!supplier) continue;
      let value = 0;
      let qty = 0;
      for (const mid of matIds) {
        const lines = linesByMaterial.get(mid) ?? [];
        const denom = Math.max(
          1,
          Array.from(supplierMaterialMap.values()).filter((s) => s.has(mid)).length,
        );
        const fraction = 1 / denom;
        value += lines.reduce((acc, l) => acc + lineValueOrZero(l), 0) * fraction;
        qty += lines.reduce((acc, l) => acc + Math.max(0, l.quantity), 0) * fraction;
      }
      bySupplierMap.set(supplierId, {
        supplierId,
        supplierName: supplier.name,
        skuCount: matIds.size,
        quantity: qty,
        inventoryValue: value,
        share: inventoryValue > 0 ? value / inventoryValue : 0,
      });
    }
    // Always surface an "Unassigned" bucket for materials with no supplier.
    const assignedMats = new Set<string>();
    for (const s of supplierMaterialMap.values()) for (const m of s) assignedMats.add(m);
    const unassignedMats = materials.filter((m) => !assignedMats.has(m.id));
    if (unassignedMats.length > 0) {
      let value = 0;
      let qty = 0;
      for (const m of unassignedMats) {
        const lines = linesByMaterial.get(m.id) ?? [];
        value += lines.reduce((acc, l) => acc + lineValueOrZero(l), 0);
        qty += lines.reduce((acc, l) => acc + Math.max(0, l.quantity), 0);
      }
      bySupplierMap.set('__unassigned__', {
        supplierId: null,
        supplierName: 'Unassigned (no PO history)',
        skuCount: unassignedMats.length,
        quantity: qty,
        inventoryValue: value,
        share: inventoryValue > 0 ? value / inventoryValue : 0,
      });
    }
    const bySupplier = Array.from(bySupplierMap.values()).sort((a, b) => b.inventoryValue - a.inventoryValue);

    // Exceptions: low + out of stock, sorted by severity
    const exceptions = allLines
      .filter((l) => l.status === 'LOW_STOCK' || l.status === 'OUT_OF_STOCK')
      .sort((a, b) => {
        if (a.status === 'OUT_OF_STOCK' && b.status !== 'OUT_OF_STOCK') return -1;
        if (b.status === 'OUT_OF_STOCK' && a.status !== 'OUT_OF_STOCK') return 1;
        return a.quantity - b.quantity;
      })
      .slice(0, 200);

    // Inventory pagination
    const totalLines = allLines.length;
    const start = (q.page - 1) * q.pageSize;
    const inventoryPage = allLines
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.locationName.localeCompare(b.locationName))
      .slice(start, start + q.pageSize);

    const kpis: ReportKpis = {
      skuCount: skuSet.size,
      totalQuantity,
      inventoryValue,
      lowStockCount,
      outOfStockCount,
      categoryCount: categorySet.size,
      locationCount: locationSet.size,
      supplierCount,
      movementCount: movements.length,
      currency: CURRENCY,
      generatedAt: new Date().toISOString(),
      rangeLabel: safeRangeLabel(q),
    };

    return {
      kpis,
      byStatus,
      byCategory,
      byLocation,
      bySupplier,
      exceptions,
      movements,
      movementSummary,
      inventory: inventoryPage,
      inventoryTotal: totalLines,
      page: q.page,
      pageSize: q.pageSize,
      currency: CURRENCY,
      generatedAt: kpis.generatedAt,
    };
  },
};
