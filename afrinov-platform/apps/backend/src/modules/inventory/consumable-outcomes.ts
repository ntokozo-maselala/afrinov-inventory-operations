// What has been closed off against issue lines of tracked consumables: used up
// or broken (consumable_outcomes). Kept apart from the service so the inventory
// and consumption services can read the totals without importing it.
import { Prisma } from '@prisma/client';
import { toDecimal } from '../../shared/decimal.js';

type Decimal = Prisma.Decimal;

export interface ClosedOff {
  usedUp: Decimal;
  broken: Decimal;
}

/** An outcome that still counts: neither a withdrawal nor withdrawn. */
export const LIVE_OUTCOME = { withdrawsId: null, withdrawnBy: { is: null } } satisfies Prisma.ConsumableOutcomeWhereInput;

export const closedTotal = (c: ClosedOff | undefined): Decimal => (c ? c.usedUp.plus(c.broken) : toDecimal(0));

/**
 * Write one outcome against an issue line and its audit entry, inside the
 * caller's transaction. The caller has already checked the issue, that the item
 * tracks use, and that the quantity fits in what is still out, under the lock.
 */
export async function writeOutcome(
  tx: Pick<Prisma.TransactionClient, 'consumableOutcome' | 'auditLogEntry'>,
  input: {
    issueTransactionId: string; outcome: 'USED_UP' | 'BROKEN'; quantity: Decimal; note: string | null; actorId: string;
    /** The RETURN booked in the same counter visit, whose Movements row shows this mark. */
    returnTransactionId?: string | null;
    /** When the visit was booked, so the mark and its return share a time. */
    createdAt?: Date;
  },
): Promise<string> {
  const row = await tx.consumableOutcome.create({
    data: {
      issueTransactionId: input.issueTransactionId, outcome: input.outcome, quantity: input.quantity, note: input.note, actorId: input.actorId,
      returnTransactionId: input.returnTransactionId ?? null, ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
  await tx.auditLogEntry.create({
    data: {
      actorId: input.actorId,
      action: 'CONSUMABLE_OUTCOME',
      entityType: 'InventoryTransaction',
      entityId: input.issueTransactionId,
      after: { outcomeId: row.id, outcome: input.outcome, quantity: input.quantity.toString(), note: input.note } as Prisma.InputJsonValue,
    },
  });
  return row.id;
}

/** Used up and broken so far on each issue line asked for; lines with none are left out. */
export async function closedOffAgainst(
  client: Pick<Prisma.TransactionClient, 'consumableOutcome'>,
  issueTransactionIds: string[],
): Promise<Map<string, ClosedOff>> {
  const out = new Map<string, ClosedOff>();
  if (issueTransactionIds.length === 0) return out;
  const groups = await client.consumableOutcome.groupBy({
    by: ['issueTransactionId', 'outcome'],
    where: { issueTransactionId: { in: issueTransactionIds }, ...LIVE_OUTCOME },
    _sum: { quantity: true },
  });
  for (const g of groups) {
    const c = out.get(g.issueTransactionId) ?? { usedUp: toDecimal(0), broken: toDecimal(0) };
    const qty = g._sum.quantity ?? toDecimal(0);
    if (g.outcome === 'USED_UP') c.usedUp = c.usedUp.plus(qty);
    else c.broken = c.broken.plus(qty);
    out.set(g.issueTransactionId, c);
  }
  return out;
}
