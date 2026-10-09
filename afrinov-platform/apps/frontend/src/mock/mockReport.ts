// Mock-layer report builder for /api/v1/reports/inventory.
//
// This is a JS replica of the backend `ReportService.inventory` logic. It
// is invoked only when `VITE_FRONTEND_ONLY === 'true'` (i.e. when the
// frontend is running without a real backend). The output shape MUST stay
// in sync with the backend `ReportResult` so the UI renders identically.
//
// Note: this module has no Prisma/Database dependency; it works directly on
// the in-memory mock state.

import { classifyItem, needsAttention, type StatusBands } from '../lib/stockStatus';
import type { MockMaterial, MockLocation, MockSupplier, MockPurchaseOrder, MockInventoryTransaction } from './types';

export interface ReportQuery {
  range: 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';
  from?: string;
  to?: string;
  category: string[];
  locationId: string[];
  supplierId: string[];
  materialId: string[];
  stockStatus: 'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  itemStatus: 'ALL' | 'ACTIVE' | 'INACTIVE';
  search?: string;
  movementType?: 'RECEIPT' | 'ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT' | 'RETURN';
  page: number;
  pageSize: number;
}

export interface ReportInventoryLine {
  materialId: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  unitOfMeasure: string;
  unitCost: number | null;
  requiredStock: number;
  active: boolean;
  locationId: string;
  locationName: string;
  locationType: string;
  quantity: number;
  inventoryValue: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  lastUpdated: string | null;
}

export interface ReportCategoryRow {
  category: string;
  skuCount: number;
  quantity: number;
  inventoryValue: number;
  share: number;
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
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
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
  category: string;
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
  // (the reversal that cancels it). Optional: older payloads omit them.
  reversesId?: string | null;
  reversedById?: string | null;
}

// A reversed movement and its reversal cancel out. Totals and charts leave
// both out; movement lists still show them.
export function isReversedPair(m: Pick<ReportMovementRow, 'reversesId' | 'reversedById'>): boolean {
  return !!(m.reversesId || m.reversedById);
}
export interface ReportMovementSummary {
  receipts: { count: number; quantity: number };
  issues: { count: number; quantity: number };
  transfers: { count: number; quantity: number };
  adjustments: { count: number; quantity: number };
  returns: { count: number; quantity: number };
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
  exceptions: ReportInventoryLine[];
  movements: ReportMovementRow[];
  movementSummary: ReportMovementSummary;
  inventory: ReportInventoryLine[];
  inventoryTotal: number;
  page: number;
  pageSize: number;
  currency: string;
  generatedAt: string;
}

const CURRENCY = 'ZAR';

const CATEGORY_LABELS: Record<string, string> = {
  FASTENERS_SLUGS_INSULATION: 'Fasteners, slugs, insulation',
  TOOLING_PPE_ELECTRICAL: 'Tooling, PPE, electrical',
  PROJECT_MATERIAL: 'Project material',
  CONSUMABLES: 'Consumables',
  TOOLS: 'Tools',
};

function rangeLabel(q: ReportQuery): string {
  switch (q.range) {
    case 'ALL': return 'All time';
    case 'TODAY': return 'Today';
    case 'WEEK': return 'This week';
    case 'MONTH': return 'This month';
    case 'QUARTER': return 'This quarter';
    case 'YEAR': return 'This year';
    case 'CUSTOM': {
      const f = q.from ? q.from.slice(0, 10) : '?';
      const t = q.to ? q.to.slice(0, 10) : '?';
      return `${f} → ${t}`;
    }
  }
}

function resolveDateWindow(q: ReportQuery, now: Date = new Date()): { from: Date | null; to: Date | null } {
  switch (q.range) {
    case 'ALL': return { from: null, to: null };
    case 'TODAY': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
      return { from: start, to: end };
    }
    case 'WEEK': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const d = start.getUTCDay();
      start.setUTCDate(start.getUTCDate() - d);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
      return { from: start, to: end };
    }
    case 'MONTH': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return { from: start, to: end };
    }
    case 'QUARTER': {
      const q0 = Math.floor(now.getUTCMonth() / 3) * 3;
      const start = new Date(Date.UTC(now.getUTCFullYear(), q0, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), q0 + 3, 1));
      return { from: start, to: end };
    }
    case 'YEAR': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
      return { from: start, to: end };
    }
    case 'CUSTOM':
      return { from: q.from ? new Date(q.from) : null, to: q.to ? new Date(q.to) : null };
  }
}

// Mirrors the backend: OUT_OF_STOCK when the location holds nothing, LOW_STOCK
// when the item as a whole is URGENT or WARNING on the stock status rule.
function classifyStatus(quantity: number, itemNeedsReorder: boolean): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' {
  if (quantity <= 0) return 'OUT_OF_STOCK';
  if (itemNeedsReorder) return 'LOW_STOCK';
  return 'IN_STOCK';
}

interface ReportInput {
  materials: MockMaterial[];
  locations: MockLocation[];
  suppliers: MockSupplier[];
  purchaseOrders: MockPurchaseOrder[];
  transactions: MockInventoryTransaction[];
  bands?: StatusBands;
}

export function buildReport(q: ReportQuery, input: ReportInput): ReportResult {
  // Filter materials
  let materials = input.materials.slice();
  if (q.itemStatus === 'ACTIVE') materials = materials.filter((m) => m.active);
  if (q.itemStatus === 'INACTIVE') materials = materials.filter((m) => !m.active);
  if (q.category.length > 0) materials = materials.filter((m) => q.category.includes(m.category));
  if (q.materialId.length > 0) materials = materials.filter((m) => q.materialId.includes(m.id));
  if (q.search) {
    const needle = q.search.toLowerCase();
    materials = materials.filter((m) => m.sku.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle));
  }

  // Build balance map
  const balanceMap = new Map<string, number>();
  for (const t of input.transactions) {
    const key = `${t.materialId}|${t.locationId}`;
    balanceMap.set(key, (balanceMap.get(key) ?? 0) + Number(t.quantity));
  }

  // Last update per material
  const lastUpdate = new Map<string, string>();
  for (const t of input.transactions) {
    const cur = lastUpdate.get(t.materialId);
    if (!cur || t.postedAt > cur) lastUpdate.set(t.materialId, t.postedAt);
  }

  const locMap = new Map(input.locations.map((l) => [l.id, l]));
  const totalByMaterial = new Map<string, number>();
  for (const [k, qty] of balanceMap) {
    const id = k.split('|')[0]!;
    totalByMaterial.set(id, (totalByMaterial.get(id) ?? 0) + qty);
  }
  const itemNeedsReorder = (m: MockMaterial) =>
    needsAttention(classifyItem(totalByMaterial.get(m.id) ?? 0, Number(m.requiredStock), input.bands).status);

  // Build initial lines: one per (material, location) where balance exists.
  // Materials with no balance at all get a synthetic "no location" row so
  // they still appear in the inventory table and exception list.
  const allLines: ReportInventoryLine[] = [];
  for (const m of materials) {
    const myBals = Array.from(balanceMap.entries())
      .filter(([k]) => k.startsWith(`${m.id}|`))
      .map(([k, qty]) => {
        const locId = k.split('|')[1]!;
        return { locId, qty };
      });
    if (myBals.length === 0) {
      const line: ReportInventoryLine = {
        materialId: m.id,
        sku: m.sku,
        name: m.name,
        description: m.description ?? null,
        category: m.category,
        unitOfMeasure: m.unitOfMeasure,
        unitCost: m.unitCost !== undefined ? Number(m.unitCost) : null,
        requiredStock: Number(m.requiredStock),
        active: m.active,
        locationId: '',
        locationName: '—',
        locationType: '—',
        quantity: 0,
        inventoryValue: 0,
        status: classifyStatus(0, true),
        lastUpdated: lastUpdate.get(m.id) ?? null,
      };
      if (q.stockStatus === 'ALL' || line.status === q.stockStatus) allLines.push(line);
      continue;
    }
    for (const { locId, qty } of myBals) {
      if (q.locationId.length > 0 && !q.locationId.includes(locId)) continue;
      const loc = locMap.get(locId);
      const required = Number(m.requiredStock);
      const cost = m.unitCost !== undefined ? Number(m.unitCost) : null;
      const value = cost === null ? 0 : qty * cost;
      const line: ReportInventoryLine = {
        materialId: m.id,
        sku: m.sku,
        name: m.name,
        description: m.description ?? null,
        category: m.category,
        unitOfMeasure: m.unitOfMeasure,
        unitCost: cost,
        requiredStock: required,
        active: m.active,
        locationId: locId,
        locationName: loc?.name ?? '—',
        locationType: loc?.type ?? '—',
        quantity: qty,
        inventoryValue: value,
        status: classifyStatus(qty, itemNeedsReorder(m)),
        lastUpdated: lastUpdate.get(m.id) ?? null,
      };
      if (q.stockStatus !== 'ALL' && line.status !== q.stockStatus) continue;
      allLines.push(line);
    }
  }

  // KPI
  const skuSet = new Set(allLines.map((l) => l.materialId));
  const totalQuantity = allLines.reduce((acc, l) => acc + Math.max(0, l.quantity), 0);
  const inventoryValue = allLines.reduce((acc, l) => acc + (l.unitCost === null ? 0 : l.inventoryValue), 0);
  const lowStockCount = allLines.filter((l) => l.status === 'LOW_STOCK').length;
  const outOfStockCount = allLines.filter((l) => l.status === 'OUT_OF_STOCK').length;
  const categorySet = new Set(materials.map((m) => m.category));
  const locationSet = new Set(allLines.map((l) => l.locationId).filter(Boolean));

  // Suppliers: via PO history (mirrors backend logic)
  const supplierMap = new Map<string, MockSupplier>();
  const supplierMaterialMap = new Map<string, Set<string>>();
  for (const po of input.purchaseOrders) {
    if (q.supplierId.length > 0 && !q.supplierId.includes(po.supplierId)) continue;
    const sup = input.suppliers.find((s) => s.id === po.supplierId);
    if (!sup) continue;
    supplierMap.set(sup.id, sup);
  }
  for (const po of input.purchaseOrders) {
    const lines = po.lines;
    for (const l of lines) {
      if (!materials.find((m) => m.id === l.materialId)) continue;
      const set = supplierMaterialMap.get(po.supplierId) ?? new Set<string>();
      set.add(l.materialId);
      supplierMaterialMap.set(po.supplierId, set);
    }
  }
  if (q.supplierId.length > 0) {
    for (const id of q.supplierId) {
      if (!supplierMap.has(id)) {
        const s = input.suppliers.find((x) => x.id === id);
        if (s) supplierMap.set(s.id, s);
      }
    }
  }

  // Movements
  const { from, to } = resolveDateWindow(q);
  const matIdSet = new Set(materials.map((m) => m.id));
  let trx = input.transactions.filter((t) => matIdSet.has(t.materialId));
  if (from) trx = trx.filter((t) => new Date(t.postedAt) >= from);
  if (to) trx = trx.filter((t) => new Date(t.postedAt) < to);
  if (q.movementType) trx = trx.filter((t) => t.type === q.movementType);
  trx.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  trx = trx.slice(0, 1000);

  const movements: ReportMovementRow[] = trx.map((t) => {
    const m = materials.find((x) => x.id === t.materialId) ?? input.materials.find((x) => x.id === t.materialId);
    const l = locMap.get(t.locationId);
    return {
      id: t.id,
      postedAt: t.postedAt,
      type: t.type,
      materialId: t.materialId,
      materialSku: m?.sku ?? t.materialId,
      materialName: m?.name ?? 'Unknown',
      category: m?.category ?? 'CONSUMABLES',
      locationId: t.locationId,
      locationName: l?.name ?? t.locationId,
      quantity: Number(t.quantity),
      actorName: 'Dev User',
      reasonCode: t.reasonCode ?? null,
      reasonNote: t.reasonNote ?? null,
      projectNumber: t.projectNumber ?? null,
      referenceType: t.referenceType ?? null,
      referenceId: t.referenceId ?? null,
      reversesId: t.reversesId ?? null,
      reversedById: input.transactions.find((r) => r.reversesId === t.id)?.id ?? null,
    };
  });
  const effective = movements.filter((m) => !isReversedPair(m));

  const movementSummary: ReportMovementSummary = {
    receipts: { count: 0, quantity: 0 },
    issues: { count: 0, quantity: 0 },
    transfers: { count: 0, quantity: 0 },
    adjustments: { count: 0, quantity: 0 },
    returns: { count: 0, quantity: 0 },
    total: { count: effective.length, quantity: effective.reduce((a, m) => a + Math.abs(m.quantity), 0) },
  };
  for (const m of effective) {
    if (m.type === 'RECEIPT') { movementSummary.receipts.count++; movementSummary.receipts.quantity += m.quantity; }
    else if (m.type === 'ISSUE') { movementSummary.issues.count++; movementSummary.issues.quantity += Math.abs(m.quantity); }
    else if (m.type === 'TRANSFER_IN' || m.type === 'TRANSFER_OUT') { movementSummary.transfers.count++; movementSummary.transfers.quantity += Math.abs(m.quantity); }
    else if (m.type === 'RETURN') { movementSummary.returns.count++; movementSummary.returns.quantity += m.quantity; }
    else if (m.type === 'ADJUSTMENT') { movementSummary.adjustments.count++; movementSummary.adjustments.quantity += Math.abs(m.quantity); }
  }

  // By status
  const byStatus: ReportStatusRow[] = (['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const).map((status) => {
    const filt = allLines.filter((l) => l.status === status);
    return {
      status,
      skuCount: new Set(filt.map((l) => l.materialId)).size,
      quantity: filt.reduce((a, l) => a + Math.max(0, l.quantity), 0),
      inventoryValue: filt.reduce((a, l) => a + (l.unitCost === null ? 0 : l.inventoryValue), 0),
    };
  });

  // By category
  const byCategoryMap = new Map<string, ReportCategoryRow>();
  for (const m of materials) {
    const lines = allLines.filter((l) => l.materialId === m.id);
    const row = byCategoryMap.get(m.category) ?? { category: m.category, skuCount: 0, quantity: 0, inventoryValue: 0, share: 0 };
    row.skuCount++;
    row.quantity += lines.reduce((a, l) => a + Math.max(0, l.quantity), 0);
    row.inventoryValue += lines.reduce((a, l) => a + (l.unitCost === null ? 0 : l.inventoryValue), 0);
    byCategoryMap.set(m.category, row);
  }
  const byCategory = Array.from(byCategoryMap.values())
    .map((r) => ({ ...r, share: inventoryValue > 0 ? r.inventoryValue / inventoryValue : 0 }))
    .sort((a, b) => b.inventoryValue - a.inventoryValue);

  // By location
  const byLocationMap = new Map<string, ReportLocationRow>();
  for (const l of allLines) {
    if (!l.locationId) continue;
    const row = byLocationMap.get(l.locationId) ?? {
      locationId: l.locationId, locationName: l.locationName, locationType: l.locationType,
      quantity: 0, inventoryValue: 0, share: 0,
    };
    row.quantity += Math.max(0, l.quantity);
    row.inventoryValue += l.unitCost === null ? 0 : l.inventoryValue;
    byLocationMap.set(l.locationId, row);
  }
  const byLocation = Array.from(byLocationMap.values())
    .map((r) => ({ ...r, share: inventoryValue > 0 ? r.inventoryValue / inventoryValue : 0 }))
    .sort((a, b) => b.inventoryValue - a.inventoryValue);

  // By supplier
  const bySupplierMap = new Map<string, ReportSupplierRow>();
  for (const [supplierId, matIds] of supplierMaterialMap.entries()) {
    const supplier = supplierMap.get(supplierId);
    if (!supplier) continue;
    let value = 0, qty = 0;
    for (const mid of matIds) {
      const lines = allLines.filter((l) => l.materialId === mid);
      const denom = Math.max(1, Array.from(supplierMaterialMap.values()).filter((s) => s.has(mid)).length);
      const fraction = 1 / denom;
      value += lines.reduce((a, l) => a + (l.unitCost === null ? 0 : l.inventoryValue), 0) * fraction;
      qty += lines.reduce((a, l) => a + Math.max(0, l.quantity), 0) * fraction;
    }
    bySupplierMap.set(supplierId, {
      supplierId, supplierName: supplier.name, skuCount: matIds.size, quantity: qty, inventoryValue: value,
      share: inventoryValue > 0 ? value / inventoryValue : 0,
    });
  }
  const assignedMats = new Set<string>();
  for (const s of supplierMaterialMap.values()) for (const m of s) assignedMats.add(m);
  const unassignedMats = materials.filter((m) => !assignedMats.has(m.id));
  if (unassignedMats.length > 0) {
    let value = 0, qty = 0;
    for (const m of unassignedMats) {
      const lines = allLines.filter((l) => l.materialId === m.id);
      value += lines.reduce((a, l) => a + (l.unitCost === null ? 0 : l.inventoryValue), 0);
      qty += lines.reduce((a, l) => a + Math.max(0, l.quantity), 0);
    }
    bySupplierMap.set('__unassigned__', {
      supplierId: null, supplierName: 'Unassigned (no PO history)', skuCount: unassignedMats.length, quantity: qty, inventoryValue: value,
      share: inventoryValue > 0 ? value / inventoryValue : 0,
    });
  }
  const bySupplier = Array.from(bySupplierMap.values()).sort((a, b) => b.inventoryValue - a.inventoryValue);

  // Exceptions
  const exceptions = allLines
    .filter((l) => l.status === 'LOW_STOCK' || l.status === 'OUT_OF_STOCK')
    .sort((a, b) => {
      if (a.status === 'OUT_OF_STOCK' && b.status !== 'OUT_OF_STOCK') return -1;
      if (b.status === 'OUT_OF_STOCK' && a.status !== 'OUT_OF_STOCK') return 1;
      return a.quantity - b.quantity;
    })
    .slice(0, 200);

  // Pagination
  const totalLines = allLines.length;
  const start = (q.page - 1) * q.pageSize;
  const inventoryPage = allLines
    .slice()
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
    supplierCount: supplierMap.size,
    movementCount: movements.length,
    currency: CURRENCY,
    generatedAt: new Date().toISOString(),
    rangeLabel: rangeLabel(q),
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
}

export { CATEGORY_LABELS };
