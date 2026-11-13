// Slips someone issued or lent to themselves (system audit F5, ADR-039): the
// recipient is linked to a user account, and that account posted the slip.
// A PIN or a signature proves nothing there, as both are the issuer's own.
// They are allowed (one store controller works the counter alone) and shown
// on the Dashboard, for someone else to look at.
import { InventoryTransactionType } from '@prisma/client';
import { prisma } from '../../shared/db.js';

export const SELF_ISSUE_DAYS = 30;

export interface SelfIssuedSlip {
  issueId: string;
  kind: 'ISSUE' | 'LOAN';
  postedAt: string;
  by: { id: string; name: string };
  recipient: { id: string; name: string };
  lines: number;
}

/** The last 30 days' self-issued slips, newest first, at most 200. */
export async function selfIssuedSlips(now: Date = new Date(), days = SELF_ISSUE_DAYS): Promise<{ days: number; slips: SelfIssuedSlip[] }> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await prisma.inventoryTransaction.findMany({
    where: {
      type: { in: [InventoryTransactionType.ISSUE, InventoryTransactionType.LOAN] },
      issueId: { not: null },
      postedAt: { gte: since },
      reversesId: null,
      recipient: { userId: { not: null } },
    },
    select: {
      issueId: true, type: true, postedAt: true, actorId: true,
      actor: { select: { id: true, name: true } },
      recipient: { select: { id: true, name: true, userId: true } },
    },
    orderBy: { postedAt: 'desc' },
  });
  const slips = new Map<string, SelfIssuedSlip>();
  for (const r of rows) {
    if (!r.recipient || r.recipient.userId !== r.actorId) continue;
    const seen = slips.get(r.issueId!);
    if (seen) { seen.lines += 1; continue; }
    if (slips.size >= 200) continue;
    slips.set(r.issueId!, {
      issueId: r.issueId!, kind: r.type === InventoryTransactionType.LOAN ? 'LOAN' : 'ISSUE', postedAt: r.postedAt.toISOString(),
      by: r.actor, recipient: { id: r.recipient.id, name: r.recipient.name }, lines: 1,
    });
  }
  return { days, slips: [...slips.values()] };
}
