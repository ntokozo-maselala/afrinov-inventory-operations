// Used up or broken: what became of a tracked consumable (Material.trackUse)
// after it was issued. When the stub of a disc or a broken blade comes back to
// the counter, its issue line is closed off; whatever is neither returned nor
// closed off is still out with the person. No stock moves here: it left the
// shelf at the issue, and the Consumption report already counts it as used.
//
// Outcomes are only ever added to. A mistake is withdrawn by a row naming the
// outcome, with a reason; the two then count for nothing, as a reversal does
// in the ledger. Returns and outcomes share one limit, what is still out, so
// both take the issue's balance lock.
import { Prisma, InventoryTransactionType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { lockInventoryBalances } from '../../shared/inventory/balances.js';
import { returnedAgainst } from './inventory.service.js';
import { closedOffAgainst, writeOutcome } from './consumable-outcomes.js';

type Decimal = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export interface RecordOutcomeInput {
  issueTransactionId: string;
  outcome: 'USED_UP' | 'BROKEN';
  quantity: number | string | Decimal;
  note?: string;
  actorId: string;
}

export interface WithdrawOutcomeInput {
  outcomeId: string;
  reason: string;
  actorId: string;
}

/** Where an issue line stands. Quantities are decimal strings. */
export interface IssueUse {
  issued: string;
  returned: string;
  usedUp: string;
  broken: string;
  /** issued − returned − used up − broken. */
  stillOut: string;
}

export interface OutcomeRow {
  id: string;
  outcome: 'USED_UP' | 'BROKEN';
  quantity: string;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
  /** Set once the outcome has been withdrawn. */
  withdrawn: { by: string; at: string; reason: string } | null;
}

export interface IssueOutcomes extends IssueUse {
  issueTransactionId: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  /** Whether the item asks for outcomes now; earlier outcomes stay listed when it is switched off. */
  trackUse: boolean;
  /** Oldest first; a withdrawal is shown on the outcome it withdrew. */
  outcomes: OutcomeRow[];
}

async function issueUse(tx: Pick<Tx, 'inventoryTransaction' | 'consumableOutcome'>, issue: { id: string; quantity: Decimal }): Promise<IssueUse> {
  const issued = issue.quantity.negated();
  const [returned, closed] = await Promise.all([returnedAgainst(issue.id, tx), closedOffAgainst(tx, [issue.id])]);
  const c = closed.get(issue.id);
  const usedUp = c?.usedUp ?? toDecimal(0);
  const broken = c?.broken ?? toDecimal(0);
  return {
    issued: issued.toString(),
    returned: returned.toString(),
    usedUp: usedUp.toString(),
    broken: broken.toString(),
    stillOut: issued.minus(returned).minus(usedUp).minus(broken).toString(),
  };
}

export const ConsumableOutcomeService = {
  /**
   * Close off part of an issue line as used up or broken. Only an unreversed
   * issue of an item that tracks use, and at most what is still out: issued,
   * less what came back and what was closed off before.
   */
  async record(input: RecordOutcomeInput, within?: Tx): Promise<{ outcomeId: string } & IssueUse> {
    const qty = toDecimal(input.quantity);
    if (!gtZero(qty)) throw Errors.validation('Quantity must be positive');

    return inTx(within, async (tx) => {
      const issue = await tx.inventoryTransaction.findUnique({
        where: { id: input.issueTransactionId },
        include: { reversedBy: { select: { id: true } }, material: { select: { sku: true, trackUse: true } } },
      });
      if (!issue) throw Errors.notFound('InventoryTransaction');
      if (issue.type !== InventoryTransactionType.ISSUE || issue.reversesId) {
        throw Errors.invalidState('Only an issue can be marked used up or broken.');
      }
      if (issue.reversedBy) throw Errors.invalidState(`This issue of ${issue.material.sku} has been reversed, so there is nothing to mark.`);
      if (!issue.material.trackUse) {
        throw Errors.invalidState(`${issue.material.sku} does not track use after issue. Switch it on for the item first.`);
      }

      // The same lock a return against this issue takes, so the two cannot both spend what is still out.
      await lockInventoryBalances([{ materialId: issue.materialId, locationId: issue.locationId }], tx);
      const before = await issueUse(tx, issue);
      const stillOut = toDecimal(before.stillOut);
      if (qty.gt(stillOut)) {
        throw Errors.validation(
          `Cannot mark ${qty.toString()} × ${issue.material.sku}: only ${stillOut.toString()} of the ${before.issued} issued is still out.`,
          { ...before },
        );
      }

      const outcomeId = await writeOutcome(tx, {
        issueTransactionId: issue.id, outcome: input.outcome, quantity: qty, note: input.note?.trim() || null, actorId: input.actorId,
      });
      return { outcomeId, ...(await issueUse(tx, issue)) };
    });
  },

  /** Withdraw an outcome recorded by mistake, with a reason. The outcome and the withdrawal are both kept. */
  async withdraw(input: WithdrawOutcomeInput, within?: Tx): Promise<{ withdrawalId: string } & IssueUse> {
    const reason = input.reason.trim();
    if (reason.length < 3) throw Errors.validation('Say why this is being withdrawn');

    try {
      return await inTx(within, async (tx) => {
        const outcome = await tx.consumableOutcome.findUnique({
          where: { id: input.outcomeId },
          include: { withdrawnBy: { select: { id: true } }, issue: { select: { id: true, quantity: true } } },
        });
        if (!outcome) throw Errors.notFound('ConsumableOutcome');
        if (outcome.withdrawsId) throw Errors.invalidState('A withdrawal cannot itself be withdrawn. Record the outcome again instead.');
        if (outcome.withdrawnBy) throw Errors.conflict('This has already been withdrawn.');

        const row = await tx.consumableOutcome.create({
          data: {
            issueTransactionId: outcome.issueTransactionId,
            outcome: outcome.outcome,
            quantity: outcome.quantity,
            note: reason,
            withdrawsId: outcome.id,
            actorId: input.actorId,
          },
        });
        await tx.auditLogEntry.create({
          data: {
            actorId: input.actorId,
            action: 'CONSUMABLE_OUTCOME_WITHDRAW',
            entityType: 'InventoryTransaction',
            entityId: outcome.issueTransactionId,
            after: { outcomeId: outcome.id, withdrawalId: row.id, reason } as Prisma.InputJsonValue,
          },
        });
        return { withdrawalId: row.id, ...(await issueUse(tx, outcome.issue)) };
      });
    } catch (err) {
      // Two requests withdrawing the same outcome at once: the unique index wins.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('This has already been withdrawn.');
      }
      throw err;
    }
  },

  /** One issue line: where it stands, and every outcome recorded against it. */
  async forIssue(issueTransactionId: string): Promise<IssueOutcomes> {
    const issue = await prisma.inventoryTransaction.findUnique({
      where: { id: issueTransactionId },
      include: { material: { select: { sku: true, name: true, unitOfMeasure: true, trackUse: true } } },
    });
    if (!issue || issue.type !== InventoryTransactionType.ISSUE || issue.reversesId) throw Errors.notFound('Issue');
    const [use, rows] = await Promise.all([
      issueUse(prisma, issue),
      prisma.consumableOutcome.findMany({
        where: { issueTransactionId },
        include: { actor: { select: { name: true } } },
        // Marks of one counter visit share a time: used up first, then broken.
        orderBy: [{ createdAt: 'asc' }, { outcome: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const withdrawalOf = new Map(rows.filter((r) => r.withdrawsId).map((r) => [r.withdrawsId!, r]));
    return {
      issueTransactionId,
      sku: issue.material.sku,
      name: issue.material.name,
      unitOfMeasure: issue.material.unitOfMeasure,
      trackUse: issue.material.trackUse,
      ...use,
      outcomes: rows.filter((r) => !r.withdrawsId).map((r) => {
        const w = withdrawalOf.get(r.id);
        return {
          id: r.id,
          outcome: r.outcome,
          quantity: r.quantity.toString(),
          note: r.note,
          recordedBy: r.actor.name,
          recordedAt: r.createdAt.toISOString(),
          withdrawn: w ? { by: w.actor.name, at: w.createdAt.toISOString(), reason: w.note ?? '' } : null,
        };
      }),
    };
  },
};
