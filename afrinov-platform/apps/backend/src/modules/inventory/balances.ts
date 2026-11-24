// Inventory-balance helpers.
//
// `inventory_balances` is the derived / materialised view of the
// `inventory_transactions` ledger (ADR-002). The application never
// writes to it directly; it always recomputes a (material, location,
// project held for) row by aggregating the matching transactions.
//
// `recomputeBalancesFor` is the public entry point for code that is not
// already in a transaction, such as the demo seed keeping the seeded ledger
// and the seeded balances in lockstep. It is the recompute `InventoryService`
// runs after every mutation, in a transaction of its own: the balance lock
// (ADR-047) is held only until its transaction ends, so the lock, the sum and
// the write must share one, or a writer could slip in between them.
import { prisma } from '../../shared/db.js';
import { recomputeBalance, type InventoryBalanceKey } from '../../shared/inventory/balances.js';

export async function recomputeBalancesFor(key: InventoryBalanceKey): Promise<void> {
  await prisma.$transaction((tx) => recomputeBalance(key, tx));
}
