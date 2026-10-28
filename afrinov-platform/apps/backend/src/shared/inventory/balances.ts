import { Prisma } from '@prisma/client';
import { ZERO } from '../decimal.js';

type TxClient = Prisma.TransactionClient;

export interface InventoryBalanceKey {
  materialId: string;
  locationId: string;
}

/**
 * Serializes balance-changing work for the given stock keys until the current
 * transaction commits or rolls back. Sorting prevents transfer-style requests
 * that touch more than one key from deadlocking each other.
 */
export async function lockInventoryBalances(keys: InventoryBalanceKey[], tx: TxClient): Promise<void> {
  const uniqueSorted = [...new Map(
    keys.map((key) => [`${key.materialId}:${key.locationId}`, key]),
  ).values()].sort((a, b) =>
    a.materialId.localeCompare(b.materialId) || a.locationId.localeCompare(b.locationId),
  );

  for (const key of uniqueSorted) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`afrinov:inventory-balance:${key.materialId}:${key.locationId}`}))
    `;
  }
}

export async function recomputeBalance(
  materialId: string,
  locationId: string,
  tx: TxClient,
): Promise<void> {
  const agg = await tx.inventoryTransaction.aggregate({
    where: { materialId, locationId },
    _sum: { quantity: true },
  });
  const total = agg._sum.quantity ?? ZERO;
  await tx.inventoryBalance.upsert({
    where: { materialId_locationId: { materialId, locationId } },
    create: { materialId, locationId, quantity: total },
    update: { quantity: total },
  });
}

export async function getCurrentBalance(
  materialId: string,
  locationId: string,
  tx: TxClient,
): Promise<Prisma.Decimal> {
  const bal = await tx.inventoryBalance.findUnique({
    where: { materialId_locationId: { materialId, locationId } },
  });
  return bal?.quantity ?? ZERO;
}
