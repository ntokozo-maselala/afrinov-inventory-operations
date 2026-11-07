// Whether items and their status records agree (ADR-033), across a whole
// database, read-only. An item's active flag must match its newest status
// change, and an item with none must be active. Those are the rule. Inactive
// items that still hold stock are listed for clearing: they date from before
// an item had to be clear first, so finding one is work to do, not a fault.
import { Prisma } from '@prisma/client';

type Client = Pick<Prisma.TransactionClient, 'material' | 'materialStatusChange' | 'inventoryBalance'>;

export interface ItemStatusReport {
  items: number;
  statusChanges: number;
  /** The rule broken: the flag and the record disagree. */
  mismatched: Array<{ sku: string; active: boolean; recorded: boolean | null }>;
  /** Stock left on an inactive item. */
  inactiveHoldingStock: Array<{ sku: string; quantity: string }>;
}

export async function checkItemStatus(db: Client): Promise<ItemStatusReport> {
  const [items, latest, statusChanges, held] = await Promise.all([
    db.material.findMany({ select: { id: true, sku: true, active: true } }),
    db.materialStatusChange.findMany({
      distinct: ['materialId'],
      orderBy: [{ materialId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { materialId: true, active: true },
    }),
    db.materialStatusChange.count(),
    db.inventoryBalance.groupBy({ by: ['materialId'], where: { quantity: { not: 0 } }, _sum: { quantity: true } }),
  ]);
  const recorded = new Map(latest.map((c) => [c.materialId, c.active]));
  const onHand = new Map(held.map((b) => [b.materialId, b._sum.quantity]));
  const sorted = [...items].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
  return {
    items: items.length,
    statusChanges,
    mismatched: sorted
      .filter((i) => i.active !== (recorded.get(i.id) ?? true))
      .map((i) => ({ sku: i.sku, active: i.active, recorded: recorded.get(i.id) ?? null })),
    inactiveHoldingStock: sorted
      .filter((i) => !i.active && onHand.has(i.id))
      .map((i) => ({ sku: i.sku, quantity: onHand.get(i.id)!.toString() })),
  };
}
