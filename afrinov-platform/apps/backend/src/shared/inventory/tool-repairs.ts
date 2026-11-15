// Tools held for repair (system audit B2, ADR-040). A tool checked in damaged
// stays on the shelf, in the ledger, but isn't lent until someone marks it
// repaired or writes it off. Read by check-out (what can be lent), transfers
// (the hold moves with the tool) and write-off approval (a repair written off).
import { Prisma } from '@prisma/client';
import { Errors } from '../errors.js';

export const TOOL_REPAIR_REFERENCE = 'ToolRepair';
export type RepairResolution = 'REPAIRED' | 'WRITTEN_OFF';

type Db = Pick<Prisma.TransactionClient, 'toolRepair'>;
const key = (materialId: string, locationId: string) => `${materialId}|${locationId}`;

/** What is held for repair, by item and location ("materialId|locationId"). */
export async function heldForRepair(db: Db, materialIds: readonly string[]): Promise<Map<string, Prisma.Decimal>> {
  if (materialIds.length === 0) return new Map();
  const rows = await db.toolRepair.groupBy({
    by: ['materialId', 'locationId'],
    where: { materialId: { in: [...materialIds] }, resolvedAt: null },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [key(r.materialId, r.locationId), r._sum.quantity ?? new Prisma.Decimal(0)]));
}

/** Held for repair of one item at one location. */
export async function heldAt(db: Db, materialId: string, locationId: string): Promise<Prisma.Decimal> {
  return (await heldForRepair(db, [materialId])).get(key(materialId, locationId)) ?? new Prisma.Decimal(0);
}

/**
 * Moves up to `quantity` of the holds at one location to another, oldest
 * first, splitting a row when part of it moves: a damaged tool taken to the
 * repair bench is still held there. Called by a transfer, under its balance lock.
 */
export async function moveHeld(tx: Db, materialId: string, fromLocationId: string, toLocationId: string, quantity: Prisma.Decimal): Promise<void> {
  let left = quantity;
  if (!left.gt(0)) return;
  const open = await tx.toolRepair.findMany({ where: { materialId, locationId: fromLocationId, resolvedAt: null }, orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }] });
  for (const r of open) {
    if (!left.gt(0)) break;
    if (r.quantity.lte(left)) {
      await tx.toolRepair.update({ where: { id: r.id }, data: { locationId: toLocationId } });
      left = left.minus(r.quantity);
    } else {
      await tx.toolRepair.update({ where: { id: r.id }, data: { quantity: r.quantity.minus(left) } });
      await tx.toolRepair.create({
        data: { materialId, locationId: toLocationId, quantity: left, returnId: r.returnId, note: r.note, reportedById: r.reportedById, reportedAt: r.reportedAt },
      });
      left = new Prisma.Decimal(0);
    }
  }
}

/** Closes an open repair; refused when it was resolved already. */
export async function resolveRepair(
  tx: Db, id: string, resolution: RepairResolution, by: { actorId: string; note?: string | null; transactionId?: string | null },
): Promise<void> {
  const done = await tx.toolRepair.updateMany({
    where: { id, resolvedAt: null },
    data: { resolution, resolutionNote: by.note?.trim() || null, resolvedById: by.actorId, resolvedAt: new Date(), transactionId: by.transactionId ?? null },
  });
  if (done.count === 0) throw Errors.invalidState('This repair was dealt with already. Refresh the page.');
}
