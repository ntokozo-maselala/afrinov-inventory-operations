import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { SettingsService } from '../settings/settings.service.js';

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

    const [materials, locations, multiplier, alertsOn] = await Promise.all([
      materialIds.length
        ? prisma.material.findMany({
            where: {
              id: { in: materialIds },
              ...(filter.category ? { category: filter.category as Prisma.MaterialWhereInput['category'] } : {}),
            },
          })
        : Promise.resolve([]),
      locationIds.length ? prisma.location.findMany({ where: { id: { in: locationIds } } }) : Promise.resolve([]),
      SettingsService.getValue<number>('inventory.lowStockMultiplier'),
      SettingsService.getValue<boolean>('inventory.enableStockAlerts'),
    ]);

    const matMap = new Map(materials.map((m) => [m.id, m]));
    const locMap = new Map(locations.map((l) => [l.id, l]));

    return balances
      .filter((b) => matMap.has(b.materialId))
      .map((b) => {
        const m = matMap.get(b.materialId)!;
        const l = locMap.get(b.locationId)!;
        const requiredStock = m.requiredStock.mul(new Prisma.Decimal(multiplier));
        const belowThreshold = alertsOn && b.quantity.lte(requiredStock);
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

  async lowStock() {
    const [balances, multiplier, alertsOn] = await Promise.all([
      prisma.inventoryBalance.findMany(),
      SettingsService.getValue<number>('inventory.lowStockMultiplier'),
      SettingsService.getValue<boolean>('inventory.enableStockAlerts'),
    ]);
    const materialIds = Array.from(new Set(balances.map((b) => b.materialId)));
    const locationIds = Array.from(new Set(balances.map((b) => b.locationId)));
    const [materials, locations] = await Promise.all([
      materialIds.length
        ? prisma.material.findMany({ where: { id: { in: materialIds } } })
        : Promise.resolve([]),
      locationIds.length
        ? prisma.location.findMany({ where: { id: { in: locationIds } } })
        : Promise.resolve([]),
    ]);
    const matMap = new Map(materials.map((m) => [m.id, m]));
    const locMap = new Map(locations.map((l) => [l.id, l]));

    if (!alertsOn) return [];

    return balances
      .filter((b) => {
        const m = matMap.get(b.materialId);
        if (!m) return false;
        const required = m.requiredStock.mul(new Prisma.Decimal(multiplier));
        return b.quantity.lte(required);
      })
      .map((b) => {
        const m = matMap.get(b.materialId)!;
        const required = m.requiredStock.mul(new Prisma.Decimal(multiplier));
        const loc = locMap.get(b.locationId);
        return {
          materialId: m.id,
          sku: m.sku,
          name: m.name,
          unitOfMeasure: m.unitOfMeasure,
          locationId: b.locationId,
          locationName: loc?.name ?? '—',
          quantity: b.quantity.toString(),
          requiredStock: required.toString(),
        };
      });
  },

  async projectConsumption(projectNumber: string) {
    const trx = await prisma.inventoryTransaction.findMany({
      where: { projectNumber, type: 'ISSUE' },
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