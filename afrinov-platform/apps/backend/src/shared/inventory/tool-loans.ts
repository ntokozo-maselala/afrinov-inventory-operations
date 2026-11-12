// How many of each tool are out on loan. A check-out (LOAN) takes the tool off
// its location's balance, so stock on hand is what is on the shelf; a tool out
// on loan is still owned. Owned = on hand + out on loan. A tool lost on loan
// comes back (LOAN_RETURN) and is written off (ADJUSTMENT) at once, so it is
// no longer out and no longer owned.
import { InventoryTransactionType, Prisma } from '@prisma/client';

type Client = Pick<Prisma.TransactionClient, 'inventoryTransaction'>;

/** Units out on loan per item, for the given items (all when omitted), optionally as at the end of `asOf`. */
export async function onLoanByMaterial(client: Client, materialIds?: string[], asOf?: Date): Promise<Map<string, Prisma.Decimal>> {
  if (materialIds && materialIds.length === 0) return new Map();
  const groups = await client.inventoryTransaction.groupBy({
    by: ['materialId'],
    where: {
      type: { in: [InventoryTransactionType.LOAN, InventoryTransactionType.LOAN_RETURN] },
      ...(materialIds ? { materialId: { in: materialIds } } : {}),
      ...(asOf ? { postedAt: { lte: asOf } } : {}),
    },
    _sum: { quantity: true },
  });
  const out = new Map<string, Prisma.Decimal>();
  for (const g of groups) {
    const q = (g._sum.quantity ?? new Prisma.Decimal(0)).negated();
    if (q.gt(0)) out.set(g.materialId, q);
  }
  return out;
}

/** A tool still out on loans taken from one location or for one project. */
export interface ToolOut { materialId: string; sku: string; out: Prisma.Decimal }

/**
 * Tools still out on the loans matching `where`, per item: what was lent less
 * what has come back against each loan (a lost tool comes back on paper).
 * Counted per loan, so a tool checked in to another location still counts
 * against the loan it went out on. Used before closing a location or a project.
 */
export async function toolsOutOn(client: Client, where: { locationId?: string; projectNumber?: string }): Promise<ToolOut[]> {
  const loans = await client.inventoryTransaction.findMany({
    where: { type: InventoryTransactionType.LOAN, reversesId: null, ...where },
    select: { id: true, materialId: true, quantity: true, material: { select: { sku: true } } },
  });
  if (loans.length === 0) return [];
  const back = await client.inventoryTransaction.groupBy({
    by: ['referenceId'],
    where: { type: InventoryTransactionType.LOAN_RETURN, referenceType: 'ToolLoan', referenceId: { in: loans.map((l) => l.id) } },
    _sum: { quantity: true },
  });
  const returned = new Map(back.map((b) => [b.referenceId, b._sum.quantity ?? new Prisma.Decimal(0)]));
  const byItem = new Map<string, ToolOut>();
  for (const l of loans) {
    const out = l.quantity.negated().minus(returned.get(l.id) ?? 0);
    if (!out.gt(0)) continue;
    const t = byItem.get(l.materialId);
    if (t) t.out = t.out.plus(out);
    else byItem.set(l.materialId, { materialId: l.materialId, sku: l.material.sku, out });
  }
  return [...byItem.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}
