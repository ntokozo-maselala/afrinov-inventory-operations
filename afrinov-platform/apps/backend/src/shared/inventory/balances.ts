import { Prisma } from '@prisma/client';
import { ZERO } from '../decimal.js';

type TxClient = Prisma.TransactionClient;

/**
 * One balance: an item at a location, held for a project or, with null, the
 * store's own (Stores) stock. Required, so every caller says whose stock it
 * touches (Project Material Through the Store Roadmap, Phase 1).
 */
export interface InventoryBalanceKey {
  materialId: string;
  locationId: string;
  heldForProject: string | null;
}

/** The store's own stock of an item at a location, held for no project. */
export const storesStock = (materialId: string, locationId: string): InventoryBalanceKey => ({ materialId, locationId, heldForProject: null });

/** A balance row keeps Stores stock as '' so the column can be in its key. */
const rowHeldFor = (heldForProject: string | null) => heldForProject ?? '';

/** The project a balance row is held for, or null for Stores stock. */
export const heldForOf = (row: { heldForProject: string }): string | null => row.heldForProject || null;

/**
 * Serializes balance-changing work for the given stock keys until the current
 * transaction commits or rolls back. Sorting prevents transfer-style requests
 * that touch more than one key from deadlocking each other.
 */
export async function lockInventoryBalances(keys: InventoryBalanceKey[], tx: TxClient): Promise<void> {
  const name = (key: InventoryBalanceKey) => `${key.materialId}:${key.locationId}:${rowHeldFor(key.heldForProject)}`;
  const uniqueSorted = [...new Map(keys.map((key) => [name(key), key])).values()]
    .sort((a, b) => name(a).localeCompare(name(b)));

  for (const key of uniqueSorted) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`afrinov:inventory-balance:${name(key)}`}))
    `;
  }
}

export async function recomputeBalance(key: InventoryBalanceKey, tx: TxClient): Promise<void> {
  const { materialId, locationId, heldForProject } = key;
  const agg = await tx.inventoryTransaction.aggregate({
    where: { materialId, locationId, heldForProject },
    _sum: { quantity: true },
  });
  const total = agg._sum.quantity ?? ZERO;
  const row = { materialId, locationId, heldForProject: rowHeldFor(heldForProject) };
  await tx.inventoryBalance.upsert({
    where: { materialId_locationId_heldForProject: row },
    create: { ...row, quantity: total },
    update: { quantity: total },
  });
}

export async function getCurrentBalance(key: InventoryBalanceKey, tx: TxClient): Promise<Prisma.Decimal> {
  const bal = await tx.inventoryBalance.findUnique({
    where: { materialId_locationId_heldForProject: { materialId: key.materialId, locationId: key.locationId, heldForProject: rowHeldFor(key.heldForProject) } },
  });
  return bal?.quantity ?? ZERO;
}
