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
import { getCurrentBalance, recomputeBalance } from '../../shared/inventory/balances.js';
import { dispatchDomainEvents, type DomainEvent } from '../../shared/events.js';

export const STOCK_COUNT_REFERENCE = 'StockCount';

export interface StockCountInput {
  locationId: string;
  note?: string;
  lines: Array<{
    materialId: string;
    /** The system quantity the counter was shown. */
    expectedQuantity: number | string;
    countedQuantity: number | string;
  }>;
  actorId: string;
}

export interface StockCountResult {
  countId: string;
  counted: number;
  adjusted: number;
  lines: Array<{ materialId: string; variance: string; transactionId: string | null }>;
}

export const StockCountService = {
  /**
   * Post count variances and an audit entry in one database transaction.
   * Reject invalid lines, unknown materials, missing or inactive locations, and
   * quantities that no longer match the expected stock. Matching lines create
   * no adjustment; the result includes the count ID and each line's variance.
   */
  async post(input: StockCountInput): Promise<StockCountResult> {
    if (input.lines.length === 0) throw Errors.validation('Count at least one item');
    const lines = input.lines.map((l) => ({ materialId: l.materialId, expected: toDecimal(l.expectedQuantity), counted: toDecimal(l.countedQuantity) }));
    if (lines.some((l) => l.counted.isNegative())) throw Errors.validation('A counted quantity cannot be negative');
    if (new Set(lines.map((l) => l.materialId)).size !== lines.length) throw Errors.validation('Each item can appear only once in a count');
    const note = input.note?.trim() || null;

    const countId = randomUUID();
    return prisma.$transaction(async (tx) => {
      // One count at a time per location, so two counters cannot both correct the same difference.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`afrinov:stock-count:${input.locationId}`}))`;

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
            reasonNote: note ? `Stock count: ${note}` : 'Stock count',
            referenceType: STOCK_COUNT_REFERENCE,
            referenceId: countId,
            actorId: input.actorId,
          },
        });
        await recomputeBalance(l.materialId, input.locationId, tx);
        results.push({ materialId: l.materialId, variance: variance.toString(), transactionId: trx.id });
        events.push({ type: 'InventoryAdjusted', materialId: l.materialId, locationId: input.locationId, quantity: variance.toNumber() });
      }

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
