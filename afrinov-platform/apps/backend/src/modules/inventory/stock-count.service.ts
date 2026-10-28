// Stock count by location: the storeman counts what is on the shelves and the
// differences from the system are posted as COUNT_VARIANCE adjustments, all
// linked to one count. Used for the go-live count and for counts after it.
//
// The count is checked against the quantities the counter was shown. If stock
// at the location moved while they were counting (an issue at the counter, a
// receipt), posting is refused, because the difference would be wrong; the
// counter reloads the system quantities and posts again.
import { randomUUID } from 'node:crypto';
import { AdjustmentReasonCode, InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal } from '../../shared/decimal.js';
import { getCurrentBalance, recomputeBalance, lockInventoryBalances } from '../../shared/inventory/balances.js';
import { dispatchDomainEvents, type DomainEvent } from '../../shared/events.js';
import { dayRange, pageCursor, parseCursor } from '../../shared/dates.js';

export const STOCK_COUNT_REFERENCE = 'StockCount';

export interface StockCountInput {
  locationId: string;
  note?: string;
  lines: Array<{
    materialId: string;
    /** The system quantity the counter was shown. */
    expectedQuantity: number | string;
    countedQuantity: number | string;
    /** Why this item differs, as the counter wrote it. */
    note?: string;
  }>;
  actorId: string;
}

export interface StockCountResult {
  countId: string;
  counted: number;
  adjusted: number;
  lines: Array<{ materialId: string; variance: string; transactionId: string | null }>;
}

export interface CountListFilter {
  /** Whole UTC days, the last one included. */
  from?: string;
  to?: string;
  locationId?: string;
  /** A room and the locations inside it; wins over locationId. */
  locationIds?: string[];
  /** Who counted. */
  actorId?: string;
  before?: string;
  limit?: number;
}

export interface CountRecord {
  id: string;
  cursor: string;
  at: string;
  locationId: string | null;
  locationName: string;
  countedByName: string;
  counted: number;
  adjusted: number;
  note: string | null;
  /** The adjustments the count posted: counted less what the system had. */
  differences: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; quantity: string }>;
  /**
   * The full count sheet: every item counted, matched or not, with what the
   * system had. Empty for counts posted before sheets were kept.
   */
  lines: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; expected: string; counted: string; note: string | null }>;
}

export const StockCountService = {
  /** Posted counts, newest first, each with the differences it adjusted, for the stock-counts report. */
  async list(filter: CountListFilter): Promise<CountRecord[]> {
    const and: Prisma.AuditLogEntryWhereInput[] = [{ entityType: 'StockCount', action: 'STOCK_COUNT' }];
    const createdAt = dayRange(filter.from, filter.to);
    if (createdAt) and.push({ createdAt });
    if (filter.actorId) and.push({ actorId: filter.actorId });
    if (filter.locationIds) and.push({ OR: filter.locationIds.map((id) => ({ after: { path: ['locationId'], equals: id } })) });
    else if (filter.locationId) and.push({ after: { path: ['locationId'], equals: filter.locationId } });
    if (filter.before) {
      const { at, id } = parseCursor(filter.before);
      and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] });
    }
    const entries = await prisma.auditLogEntry.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(filter.limit ?? 50, 200),
    });
    const facts = entries.map((e) => (e.after ?? {}) as { locationId?: string; counted?: number; adjusted?: number; note?: string | null });
    const locationIds = [...new Set(facts.map((f) => f.locationId).filter((id): id is string => !!id))];
    const userIds = [...new Set(entries.map((e) => e.actorId).filter((id): id is string => !!id))];
    const countIds = entries.map((e) => e.entityId);
    const material = { select: { sku: true, name: true, unitOfMeasure: true } } as const;
    const [adjustments, sheetLines, locations, users] = await Promise.all([
      entries.length === 0 ? [] : prisma.inventoryTransaction.findMany({
        where: { referenceType: STOCK_COUNT_REFERENCE, referenceId: { in: countIds } },
        include: { material },
      }),
      entries.length === 0 ? [] : prisma.stockCountLine.findMany({ where: { countId: { in: countIds } }, include: { material } }),
      locationIds.length === 0 ? [] : prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } }),
      userIds.length === 0 ? [] : prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    ]);
    const locationName = new Map(locations.map((l) => [l.id, l.name]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    return entries.map((e, i) => {
      const f = facts[i]!;
      return {
        id: e.entityId,
        cursor: pageCursor(e.createdAt, e.id),
        at: e.createdAt.toISOString(),
        locationId: f.locationId ?? null,
        locationName: (f.locationId && locationName.get(f.locationId)) || 'Unknown location',
        countedByName: e.actorId ? userName.get(e.actorId) ?? 'Unknown user' : 'System',
        counted: Number(f.counted ?? 0),
        adjusted: Number(f.adjusted ?? 0),
        note: f.note ?? null,
        differences: adjustments
          .filter((t) => t.referenceId === e.entityId)
          .map((t) => ({ materialId: t.materialId, sku: t.material.sku, name: t.material.name, unitOfMeasure: t.material.unitOfMeasure, quantity: t.quantity.toString() }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        lines: sheetLines
          .filter((l) => l.countId === e.entityId)
          .map((l) => ({ materialId: l.materialId, sku: l.material.sku, name: l.material.name, unitOfMeasure: l.material.unitOfMeasure, expected: l.expectedQuantity.toString(), counted: l.countedQuantity.toString(), note: l.note }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  },


  async post(input: StockCountInput): Promise<StockCountResult> {
    if (input.lines.length === 0) throw Errors.validation('Count at least one item');
    const lines = input.lines.map((l) => ({ materialId: l.materialId, expected: toDecimal(l.expectedQuantity), counted: toDecimal(l.countedQuantity), note: l.note?.trim() || null }));
    if (lines.some((l) => l.counted.isNegative())) throw Errors.validation('A counted quantity cannot be negative');
    if (new Set(lines.map((l) => l.materialId)).size !== lines.length) throw Errors.validation('Each item can appear only once in a count');
    const note = input.note?.trim() || null;

    const countId = randomUUID();
    return prisma.$transaction(async (tx) => {
      // One count at a time per location, so two counters cannot both correct the same difference.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`afrinov:stock-count:${input.locationId}`}))`;
      await lockInventoryBalances(lines.map((line) => ({ materialId: line.materialId, locationId: input.locationId })), tx);

      const location = await tx.location.findUnique({ where: { id: input.locationId } });
      if (!location) throw Errors.notFound('Location');
      if (!location.active) throw Errors.validation(`Location ${location.name} is inactive`);

      const materials = await tx.material.findMany({ where: { id: { in: lines.map((l) => l.materialId) } }, select: { id: true, sku: true } });
      const skuById = new Map(materials.map((m) => [m.id, m.sku]));
      const unknown = lines.filter((l) => !skuById.has(l.materialId));
      if (unknown.length > 0) throw Errors.notFound('Material');

      const current = new Map<string, Prisma.Decimal>();
      const moved: Array<{ sku: string; expected: string; current: string }> = [];
      for (const l of lines) {
        const balance = await getCurrentBalance(l.materialId, input.locationId, tx);
        current.set(l.materialId, balance);
        if (!balance.eq(l.expected)) moved.push({ sku: skuById.get(l.materialId)!, expected: l.expected.toString(), current: balance.toString() });
      }
      if (moved.length > 0) {
        throw Errors.conflict(
          `Stock at ${location.name} changed while you were counting (${moved.slice(0, 3).map((m) => `${m.sku}: ${m.expected} → ${m.current}`).join(', ')}${moved.length > 3 ? ', …' : ''}). Reload the system quantities, check those items, and post again.`,
          { moved },
        );
      }

      const results: StockCountResult['lines'] = [];
      const events: DomainEvent[] = [];
      for (const l of lines) {
        const variance = l.counted.minus(current.get(l.materialId)!);
        if (variance.isZero()) {
          results.push({ materialId: l.materialId, variance: '0', transactionId: null });
          continue;
        }
        const trx = await tx.inventoryTransaction.create({
          data: {
            materialId: l.materialId,
            locationId: input.locationId,
            type: InventoryTransactionType.ADJUSTMENT,
            quantity: variance,
            reasonCode: AdjustmentReasonCode.COUNT_VARIANCE,
            // The count's note, then the item's own: "Stock count: Monthly — 3 cracked, binned".
            reasonNote: [note, l.note].some(Boolean) ? `Stock count: ${[note, l.note].filter(Boolean).join(' — ')}` : 'Stock count',
            referenceType: STOCK_COUNT_REFERENCE,
            referenceId: countId,
            actorId: input.actorId,
          },
        });
        await recomputeBalance(l.materialId, input.locationId, tx);
        results.push({ materialId: l.materialId, variance: variance.toString(), transactionId: trx.id });
        events.push({ type: 'InventoryAdjusted', materialId: l.materialId, locationId: input.locationId, quantity: variance.toNumber() });
      }

      // The full sheet, matched items included, with what the system had.
      await tx.stockCountLine.createMany({
        data: lines.map((l) => ({ countId, materialId: l.materialId, expectedQuantity: current.get(l.materialId)!, countedQuantity: l.counted, note: l.note })),
      });

      const adjusted = results.filter((r) => r.transactionId).length;
      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId,
          action: 'STOCK_COUNT',
          entityType: 'StockCount',
          entityId: countId,
          after: { locationId: input.locationId, counted: lines.length, adjusted, note } as Prisma.InputJsonValue,
        },
      });
      await dispatchDomainEvents(events);

      return { countId, counted: lines.length, adjusted, lines: results };
    });
  },
};
