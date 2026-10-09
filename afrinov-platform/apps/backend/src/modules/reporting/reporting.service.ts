import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { SettingsService } from '../settings/settings.service.js';
import { classifyItem, getStatusBands, needsAttention, type StatusBands, type StockStatus } from '../../shared/inventory/stock-status.js';

export interface StockStatusRow {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  requiredStock: string;
  /** Total across every location. */
  onHand: string;
  percentOfRequired: number | null;
  status: StockStatus;
  reorderQuantity: string;
  unitCost: string | null;
  locations: Array<{ locationId: string; locationName: string; quantity: string }>;
  /** Who it last came from: the most recent posted goods receipt with this item. */
  lastSupplier: { name: string; receivedAt: string } | null;
}

const STATUS_ORDER: Record<StockStatus, number> = { URGENT: 0, WARNING: 1, OK: 2, NOT_SET: 3 };

/** Total on hand per material, from the balances (the ledger's running totals). */
async function totalsByMaterial(materialIds?: string[]): Promise<Map<string, Prisma.Decimal>> {
  const rows = await prisma.inventoryBalance.groupBy({
    by: ['materialId'],
    where: materialIds ? { materialId: { in: materialIds } } : undefined,
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.materialId, r._sum.quantity ?? new Prisma.Decimal(0)]));
}

/** The supplier of each item's most recent posted goods receipt (counter or purchase order). */
async function lastSuppliers(materialIds: string[]): Promise<Map<string, { name: string; receivedAt: string }>> {
  const out = new Map<string, { name: string; receivedAt: string }>();
  if (materialIds.length === 0) return out;
  const lines = await prisma.goodsReceiptLine.findMany({
    where: { materialId: { in: materialIds }, goodsReceipt: { status: 'POSTED' } },
    select: { materialId: true, goodsReceipt: { select: { receivedAt: true, supplier: { select: { name: true } } } } },
    orderBy: { goodsReceipt: { receivedAt: 'desc' } },
  });
  for (const l of lines) {
    if (!out.has(l.materialId)) out.set(l.materialId, { name: l.goodsReceipt.supplier.name, receivedAt: l.goodsReceipt.receivedAt.toISOString() });
  }
  return out;
}

function statusFor(required: Prisma.Decimal, onHand: Prisma.Decimal | undefined, bands: StatusBands) {
  return classifyItem(Number(onHand ?? 0), Number(required), bands);
}

// Reporting reads only. No mutations. Computed from the ledger (ADR-002).
export const ReportingService = {
  async currentStock(filter: { category?: string; locationId?: string; materialId?: string } = {}) {
    const where: Prisma.InventoryBalanceWhereInput = {};
    if (filter.locationId) where.locationId = filter.locationId;
    if (filter.materialId) where.materialId = filter.materialId;
    const balances = await prisma.inventoryBalance.findMany({
      where,
      orderBy: [{ materialId: 'asc' }, { locationId: 'asc' }],
    });

    const materialIds = Array.from(new Set(balances.map((b) => b.materialId)));
    const locationIds = Array.from(new Set(balances.map((b) => b.locationId)));

    const [materials, locations, bands, alertsOn, totals] = await Promise.all([
      materialIds.length
        ? prisma.material.findMany({
            where: {
              id: { in: materialIds },
              ...(filter.category ? { category: filter.category as Prisma.MaterialWhereInput['category'] } : {}),
            },
          })
        : Promise.resolve([]),
      locationIds.length ? prisma.location.findMany({ where: { id: { in: locationIds } } }) : Promise.resolve([]),
      getStatusBands(),
      SettingsService.getValue<boolean>('inventory.enableStockAlerts'),
      totalsByMaterial(materialIds),
    ]);

    const matMap = new Map(materials.map((m) => [m.id, m]));
    const locMap = new Map(locations.map((l) => [l.id, l]));

    return balances
      .filter((b) => matMap.has(b.materialId))
      .map((b) => {
        const m = matMap.get(b.materialId)!;
        const l = locMap.get(b.locationId)!;
        const requiredStock = m.requiredStock;
        // The item's status, from its total across locations; the same on each of its rows.
        const item = statusFor(m.requiredStock, totals.get(m.id), bands);
        const belowThreshold = alertsOn && needsAttention(item.status);
        return {
          materialId: b.materialId,
          materialSku: m.sku,
          materialName: m.name,
          category: m.category,
          unitOfMeasure: m.unitOfMeasure,
          requiredStock: requiredStock.toString(),
          locationId: b.locationId,
          locationName: l.name,
          locationType: l.type,
          quantity: b.quantity.toString(),
          belowThreshold,
          stockStatus: alertsOn ? item.status : null,
          percentOfRequired: item.percentOfRequired,
        };
      });
  },

  async movementHistory(filter: { materialId?: string; type?: string; from?: string; to?: string; projectNumber?: string; limit?: number } = {}) {
    const where: Prisma.InventoryTransactionWhereInput = {};
    if (filter.materialId) where.materialId = filter.materialId;
    if (filter.type) where.type = filter.type as Prisma.InventoryTransactionWhereInput['type'];
    if (filter.projectNumber) where.projectNumber = filter.projectNumber;
    if (filter.from || filter.to) {
      where.postedAt = {};
      if (filter.from) where.postedAt.gte = new Date(filter.from);
      if (filter.to) where.postedAt.lte = new Date(filter.to);
    }

    const trx = await prisma.inventoryTransaction.findMany({
      where,
      include: {
        material: true,
        location: true,
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { postedAt: 'desc' },
      take: Math.min(filter.limit ?? 200, 1000),
    });
    return trx.map((t) => ({
      id: t.id,
      postedAt: t.postedAt.toISOString(),
      type: t.type,
      materialId: t.materialId,
      materialSku: t.material.sku,
      materialName: t.material.name,
      locationId: t.locationId,
      locationName: t.location.name,
      quantity: t.quantity.toString(),
      actorId: t.actorId,
      actorName: t.actor.name,
      recipientId: t.recipientId,
      reasonCode: t.reasonCode,
      reasonNote: t.reasonNote,
      projectNumber: t.projectNumber,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
    }));
  },

  /**
   * Stock status of every active item: on hand across all locations against
   * Required Stock, URGENT / WARNING / OK by the setting bands, or NOT_SET.
   * Most urgent first, then lowest percentage.
   */
  async stockStatus(filter: { status?: StockStatus[]; category?: string } = {}): Promise<StockStatusRow[]> {
    const materials = await prisma.material.findMany({
      where: { active: true, ...(filter.category ? { category: filter.category as Prisma.MaterialWhereInput['category'] } : {}) },
      orderBy: { name: 'asc' },
    });
    const ids = materials.map((m) => m.id);
    const [balances, bands, lastSupplier] = await Promise.all([
      ids.length ? prisma.inventoryBalance.findMany({ where: { materialId: { in: ids } }, include: { location: { select: { name: true } } } }) : Promise.resolve([]),
      getStatusBands(),
      lastSuppliers(ids),
    ]);
    const byMaterial = new Map<string, typeof balances>();
    for (const b of balances) byMaterial.set(b.materialId, [...(byMaterial.get(b.materialId) ?? []), b]);

    const rows = materials.map((m): StockStatusRow => {
      const mine = byMaterial.get(m.id) ?? [];
      const onHand = mine.reduce((a, b) => a.add(b.quantity), new Prisma.Decimal(0));
      const item = statusFor(m.requiredStock, onHand, bands);
      return {
        materialId: m.id,
        sku: m.sku,
        name: m.name,
        category: m.category,
        unitOfMeasure: m.unitOfMeasure,
        requiredStock: m.requiredStock.toString(),
        onHand: onHand.toString(),
        percentOfRequired: item.percentOfRequired,
        status: item.status,
        reorderQuantity: String(item.reorderQuantity),
        unitCost: m.unitCost === null ? null : m.unitCost.toString(),
        locations: mine
          .filter((b) => !b.quantity.isZero())
          .map((b) => ({ locationId: b.locationId, locationName: b.location.name, quantity: b.quantity.toString() }))
          .sort((a, b) => a.locationName.localeCompare(b.locationName)),
        lastSupplier: lastSupplier.get(m.id) ?? null,
      };
    });
    return rows
      .filter((r) => !filter.status || filter.status.length === 0 || filter.status.includes(r.status))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || (a.percentOfRequired ?? Infinity) - (b.percentOfRequired ?? Infinity)
        || a.name.localeCompare(b.name));
  },

  /** Items that need re-ordering (URGENT or WARNING); empty when stock alerts are off. */
  async lowStock(): Promise<StockStatusRow[]> {
    if (!(await SettingsService.getValue<boolean>('inventory.enableStockAlerts'))) return [];
    return this.stockStatus({ status: ['URGENT', 'WARNING'] });
  },

  async projectConsumption(projectNumber: string) {
    const trx = await prisma.inventoryTransaction.findMany({
      // Returns carry the issue's project; signed totals net them out.
      where: { projectNumber, type: { in: ['ISSUE', 'RETURN'] } },
      include: { material: true },
      orderBy: { postedAt: 'desc' },
    });

    const totals = new Map<string, { materialSku: string; materialName: string; unitOfMeasure: string; total: number }>();
    for (const t of trx) {
      const existing = totals.get(t.materialId);
      // Signed, so a reversed issue (same type, opposite sign) nets to zero.
      const qty = -t.quantity.toNumber();
      if (existing) existing.total += qty;
      else
        totals.set(t.materialId, {
          materialSku: t.material.sku,
          materialName: t.material.name,
          unitOfMeasure: t.material.unitOfMeasure,
          total: qty,
        });
    }
    return Array.from(totals.entries())
      .filter(([, v]) => v.total !== 0)
      .map(([materialId, v]) => ({ materialId, ...v }));
  },
};