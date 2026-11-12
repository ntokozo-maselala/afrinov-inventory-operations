// Whether an adjustment needs someone else's approval (ADR-028), in one place
// for every path that writes stock off or adds it: a manual adjustment, a stock
// count's differences, a tool checked in as lost, and reversing an adjustment.
//
// It does when approval is on and the item has no unit cost, or a cost of 0
// (its value can't be checked: system audit C1), the limit is 0 ("every
// adjustment waits"), or its exact value, quantity × unit cost, is over the
// limit. A write-off is judged together with the same person's other
// write-offs of that item in the last 7 days, so a large one can't be split
// into small ones (system audit C2, ADR-039). The value is rounded to cents
// only for storing and showing, never before the comparison, so R 1 000,004 is
// over a R 1 000 limit.
import { InventoryTransactionType, Prisma } from '@prisma/client';
import { SettingsService } from '../settings/settings.service.js';

export const WRITE_OFF_APPROVAL = 'inventory.requireWriteOffApproval';
export const WRITE_OFF_LIMIT = 'inventory.writeOffApprovalAbove';
/** How far back a person's write-offs of an item are added up (system audit C2). */
export const WRITE_OFF_WINDOW_DAYS = 7;

export interface WriteOffCheck {
  needsApproval: boolean;
  /** quantity × unit cost to the cent, for storing and showing; null with no unit cost. */
  value: Prisma.Decimal | null;
  limit: Prisma.Decimal;
  /** What the same person wrote off of the item in the last 7 days, to the cent, when it counted; null otherwise. */
  recentValue: Prisma.Decimal | null;
}

const ZERO = new Prisma.Decimal(0);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * The rule as set now, read once, for checking many adjustments (a page of
 * Movements, a stock count). `recentQuantity` is how much the same person
 * wrote off of the item in the last 7 days (recentWriteOffQuantity); it counts
 * only for a write-off, not for stock added.
 */
export async function writeOffRule(tx?: Prisma.TransactionClient): Promise<(quantity: Prisma.Decimal, unitCost: Prisma.Decimal | null, recentQuantity?: Prisma.Decimal) => WriteOffCheck> {
  const settings = await SettingsService.getValues([WRITE_OFF_APPROVAL, WRITE_OFF_LIMIT], tx);
  const on = settings[WRITE_OFF_APPROVAL] !== false;
  const limit = new Prisma.Decimal(Number(settings[WRITE_OFF_LIMIT]) || 0);
  return (quantity, unitCost, recentQuantity = ZERO) => {
    const priced = unitCost != null && !unitCost.isZero();
    const exact = priced ? quantity.abs().times(unitCost) : null;
    const recent = priced && quantity.isNegative() && recentQuantity.gt(0) ? recentQuantity.times(unitCost) : null;
    const judged = exact === null ? null : recent ? exact.plus(recent) : exact;
    const needsApproval = on && (judged === null || limit.isZero() || judged.gt(limit));
    return {
      needsApproval,
      value: unitCost == null ? null : cents(quantity.abs().times(unitCost)),
      limit,
      recentValue: recent ? cents(recent) : null,
    };
  };
}

export async function checkWriteOff(
  quantity: Prisma.Decimal, unitCost: Prisma.Decimal | null, tx?: Prisma.TransactionClient, recentQuantity?: Prisma.Decimal,
): Promise<WriteOffCheck> {
  return (await writeOffRule(tx))(quantity, unitCost, recentQuantity);
}

/**
 * How much of an item one person has written off in the last 7 days: their
 * adjustments that removed it, less any reversed since. One that someone else
 * approved doesn't count: it was checked already.
 */
export async function recentWriteOffQuantity(
  who: { actorId: string; materialId: string }, tx: Pick<Prisma.TransactionClient, 'inventoryTransaction' | 'adjustmentRequest'>, now = new Date(),
): Promise<Prisma.Decimal> {
  const since = new Date(now.getTime() - WRITE_OFF_WINDOW_DAYS * 86_400_000);
  const approved = await tx.adjustmentRequest.findMany({
    where: { status: 'APPROVED', materialId: who.materialId, requestedById: who.actorId, transactionId: { not: null }, decidedAt: { gte: since } },
    select: { transactionId: true },
  });
  const agg = await tx.inventoryTransaction.aggregate({
    where: {
      type: InventoryTransactionType.ADJUSTMENT, actorId: who.actorId, materialId: who.materialId,
      quantity: { lt: 0 }, postedAt: { gte: since }, reversesId: null, reversedBy: null,
      ...(approved.length > 0 ? { id: { notIn: approved.map((a) => a.transactionId!) } } : {}),
    },
    _sum: { quantity: true },
  });
  return (agg._sum.quantity ?? ZERO).negated();
}
