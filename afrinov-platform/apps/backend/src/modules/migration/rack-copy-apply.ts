// Does a racks-to-locations plan (see rack-copy.ts) inside the caller's
// transaction: copies each rack's room onto its location, adds the --create
// locations, writes each rack's full record to the audit log, then removes
// the rack. Only the racks in the plan are touched, and the caller holds the
// afrinov:location-tree lock and planned from what the transaction sees.
import type { Prisma } from '@prisma/client';
import { planRackCopy, removedRacks, type RackPlan } from './rack-copy.js';

/**
 * Reads the racks and locations and plans, inside the caller's transaction.
 * When applying (`lock`), it first takes the afrinov:location-tree lock (as
 * location edits do) and locks the Rack rows (SELECT … FOR UPDATE), so a rack
 * edited on the Racks page either lands before this reads it or waits until
 * the transaction ends: what is copied is never an older room than the one
 * removed. `rackIds` limits it to those racks (the integration tests' own).
 */
export async function readAndPlanRacks(
  tx: Prisma.TransactionClient,
  decisions: { create?: string[]; discard?: string[] },
  opts: { lock: boolean; rackIds?: string[] },
): Promise<RackPlan> {
  if (opts.lock) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:location-tree'))`;
    if (opts.rackIds) await tx.$queryRaw`SELECT id FROM racks WHERE id = ANY(${opts.rackIds}) FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM racks FOR UPDATE`;
  }
  const [racks, locations] = await Promise.all([
    tx.rack.findMany({
      where: opts.rackIds ? { id: { in: opts.rackIds } } : undefined,
      select: { id: true, code: true, name: true, description: true, locationId: true, projectNumber: true, capacity: true, status: true, notes: true },
      orderBy: { code: 'asc' },
    }),
    tx.location.findMany({ select: { id: true, name: true, code: true, type: true, active: true, parentId: true } }),
  ]);
  return planRackCopy(racks, locations, decisions);
}

export async function applyRackPlan(tx: Prisma.TransactionClient, plan: RackPlan, actorId: string): Promise<number> {
  if (plan.errors.length) throw new Error(`The plan cannot be applied: ${plan.errors.join('; ')}`);
  const handled = removedRacks(plan);
  for (const item of handled) {
    const o = item.outcome;
    let location: { id: string; name: string } | null = null;
    if (o.kind === 'set-room') {
      const before = await tx.location.findUniqueOrThrow({ where: { id: o.location.id } });
      const after = await tx.location.update({ where: { id: o.location.id }, data: { parentId: o.room.id, updatedById: actorId } });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'UPDATE', entityType: 'Location', entityId: after.id, before: before as unknown as Prisma.InputJsonValue, after: after as unknown as Prisma.InputJsonValue },
      });
      location = after;
    } else if (o.kind === 'nothing-to-copy') {
      location = o.location;
    } else if (o.kind === 'create') {
      const created = await tx.location.create({
        data: { name: o.name, type: 'RACK', parentId: o.room?.id ?? null, createdById: actorId, updatedById: actorId },
      });
      await tx.auditLogEntry.create({
        data: { actorId, action: 'CREATE', entityType: 'Location', entityId: created.id, after: created as unknown as Prisma.InputJsonValue },
      });
      location = created;
    }
    // The rack's whole record, so its history can still name it once the table is gone.
    const rack = await tx.rack.findUniqueOrThrow({ where: { id: item.rack.id }, include: { location: { select: { name: true } } } });
    const { location: room, ...record } = rack;
    await tx.auditLogEntry.create({
      data: {
        actorId,
        action: location ? 'MOVE_TO_LOCATION' : 'DISCARD',
        entityType: 'Rack',
        entityId: rack.id,
        before: { ...record, roomName: room?.name ?? null } as unknown as Prisma.InputJsonValue,
        after: location ? { locationId: location.id, locationName: location.name, dropped: item.dropped } : { dropped: item.dropped },
      },
    });
    await tx.rack.delete({ where: { id: rack.id } });
  }
  return handled.length;
}
