// Real-database tests for racks to locations (racks and locations roadmap,
// Phase 3.1): applying a plan copies each rack's room onto its location, adds
// --create locations, records each rack in the audit log and removes it, all
// in one transaction, and a second run changes nothing.
//
// Plans here cover ONLY the racks this file creates, never the database's own
// racks, so running it on a developer's database leaves their racks alone. It
// removes what it created afterwards.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, prisma, runId } from './helpers.js';
import { applyRackPlan, readAndPlanRacks } from '../src/modules/migration/rack-copy-apply.js';

describe('racks to locations against a real database', () => {
  const run = runId();
  const code = (c: string) => `IT-${c}-${run}`;
  let actorId: string;
  let roomId: string;
  let rackLocationId: string;
  const rackIds: string[] = [];
  const createdLocationIds: string[] = [];

  /** Plans over this file's racks only, as the script does: under the location-tree lock, with their rows locked. */
  async function applyOwn(decisions: { create?: string[]; discard?: string[] }) {
    return prisma.$transaction(async (tx) => {
      const plan = await readAndPlanRacks(tx, decisions, { lock: true, rackIds });
      return { plan, handled: await applyRackPlan(tx, plan, actorId) };
    });
  }

  beforeAll(async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    actorId = admin.id;
    const room = await prisma.location.create({ data: { name: `IT racks room ${run}`, type: 'STOREROOM' } });
    const rackLocation = await prisma.location.create({ data: { name: code('D1'), type: 'RACK' } });
    roomId = room.id;
    rackLocationId = rackLocation.id;
    createdLocationIds.push(room.id, rackLocation.id);
    for (const [c, name] of [['D1', 'Aisle D'], ['F7', 'Aisle F'], ['CHK', 'Check rack']] as const) {
      const rack = await prisma.rack.create({
        data: { code: code(c), name: `${name} ${run}`, locationId: room.id, capacity: 40, projectNumber: null },
      });
      rackIds.push(rack.id);
    }
  });

  afterAll(async () => {
    await prisma.rack.deleteMany({ where: { id: { in: rackIds } } });
    // Racks' locations first (they stand inside the room), then the room.
    await prisma.location.deleteMany({ where: { id: { in: createdLocationIds }, parentId: { not: null } } });
    await prisma.location.deleteMany({ where: { id: { in: createdLocationIds } } });
  });

  it('copies the room, adds and discards what was decided, records each rack and removes it', async () => {
    const { plan, handled } = await applyOwn({ create: [code('F7')], discard: [code('CHK')] });
    expect(plan.errors).toEqual([]);
    expect(handled).toBe(3);

    expect((await prisma.location.findUniqueOrThrow({ where: { id: rackLocationId } })).parentId).toBe(roomId);
    const added = await prisma.location.findUniqueOrThrow({ where: { name: code('F7') } });
    createdLocationIds.push(added.id);
    expect(added).toMatchObject({ type: 'RACK', parentId: roomId });

    expect(await prisma.rack.count({ where: { id: { in: rackIds } } })).toBe(0);
    const records = await prisma.auditLogEntry.findMany({ where: { entityType: 'Rack', entityId: { in: rackIds } } });
    const byAction = (a: string) => records.filter((r) => r.action === a);
    expect(byAction('MOVE_TO_LOCATION')).toHaveLength(2);
    expect(byAction('DISCARD')).toHaveLength(1);
    // Each record keeps the rack's identity and what was dropped, for history once the table is gone.
    expect(byAction('DISCARD')[0]!.before).toMatchObject({ code: code('CHK'), capacity: 40, roomName: `IT racks room ${run}` });
    expect(byAction('MOVE_TO_LOCATION').map((r) => (r.after as { locationName: string }).locationName).sort()).toEqual([code('D1'), code('F7')].sort());
  });

  it('changes nothing when run again', async () => {
    const before = await prisma.auditLogEntry.count({ where: { entityType: 'Rack', entityId: { in: rackIds } } });
    const { plan, handled } = await applyOwn({});
    expect(plan.items).toEqual([]);
    expect(handled).toBe(0);
    expect(await prisma.auditLogEntry.count({ where: { entityType: 'Rack', entityId: { in: rackIds } } })).toBe(before);
  });
});
