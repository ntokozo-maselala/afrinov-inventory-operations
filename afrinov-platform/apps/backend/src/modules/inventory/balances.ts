// Inventory-balance helpers.
//
// `inventory_balances` is the derived / materialised view of the
// `inventory_transactions` ledger (ADR-002). The application never
// writes to it directly; it always recomputes a (material, location,
// project held for) row by aggregating the matching transactions.
//
// `recomputeBalancesFor` is the public entry point. It is the same
// recompute that `InventoryService` runs after every mutation, outside a
// transaction, and is called by the demo seed to keep the seeded ledger
// and the seeded balances in lockstep.
import { prisma } from '../../shared/db.js';
import { recomputeBalance, type InventoryBalanceKey } from '../../shared/inventory/balances.js';

export async function recomputeBalancesFor(key: InventoryBalanceKey): Promise<void> {
  await recomputeBalance(key, prisma);
}
