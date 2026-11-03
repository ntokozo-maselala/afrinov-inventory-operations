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
