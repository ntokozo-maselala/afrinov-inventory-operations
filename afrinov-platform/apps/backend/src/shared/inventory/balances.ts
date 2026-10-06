import { Prisma } from '@prisma/client';
import { ZERO } from '../decimal.js';

type TxClient = Prisma.TransactionClient;

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
