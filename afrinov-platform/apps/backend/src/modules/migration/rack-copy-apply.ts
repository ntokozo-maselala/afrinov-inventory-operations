// Does a racks-to-locations plan (see rack-copy.ts) inside the caller's
// transaction: copies each rack's room onto its location, adds the --create
// locations, writes each rack's full record to the audit log, then removes
// the rack. Only the racks in the plan are touched, and the caller holds the
// afrinov:location-tree lock and planned from what the transaction sees.
import type { Prisma } from '@prisma/client';
import { removedRacks, type RackPlan } from './rack-copy.js';

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
