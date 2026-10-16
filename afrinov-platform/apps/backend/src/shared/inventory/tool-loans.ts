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
