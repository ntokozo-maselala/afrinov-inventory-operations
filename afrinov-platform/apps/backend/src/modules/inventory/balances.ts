// Inventory-balance helpers.
//
// `inventory_balances` is the derived / materialised view of the
// `inventory_transactions` ledger (ADR-002). The application never
// writes to it directly; it always recomputes a (material, location)
// row by aggregating the matching transactions.
//
// `recomputeBalancesFor` is the public entry point. It mirrors the
// internal helper that `InventoryService` uses after every mutation,
// and is also called by the demo seed to keep the seeded ledger and
// the seeded balances in lockstep.
import { prisma } from '../../shared/db.js';
import { ZERO } from '../../shared/decimal.js';

export async function recomputeBalancesFor(materialId: string, locationId: string): Promise<void> {
  const agg = await prisma.inventoryTransaction.aggregate({
    where: { materialId, locationId },
    _sum: { quantity: true },
  });
  const total = agg._sum.quantity ?? ZERO;
  await prisma.inventoryBalance.upsert({
    where: { materialId_locationId: { materialId, locationId } },
    create: { materialId, locationId, quantity: total },
    update: { quantity: total },
  });
}
