// Location management service.
//
// A Location is a physical place where stock is held (warehouse, workshop,
// rack, container, off-site). The service is the single source of truth for
// location lifecycle: create, update, status transitions, and dependency-
// aware deletion. All mutations write an audit entry so operational history
// remains traceable (see AuditLogEntry).
//
// The model keeps the historical `active` boolean (consumed by the inventory
// service's `checkLocationActive` guard) and the new optional master-data
// fields (code, address, contact details, …). Status is derived: ACTIVE when
// `active = true`, otherwise INACTIVE.
//
// A location may stand inside another (`parentId`): rack "D-1" in "Main
// Storeroom". One level only, and never inside a rack; stock stays on the
// location itself. In the stock workbook a rack code and a room share one
// column and nothing records which room a rack is in.
import { Prisma, type LocationType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';

export interface CreateLocationInput {
  name: string;
  code?: string;
  type: LocationType;
  active?: boolean;
  /** The room or area it stands in. */
  parentId?: string | null;
  address?: string;
  description?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
}

export interface UpdateLocationInput {
  id: string;
  name?: string;
  code?: string | null;
  type?: LocationType;
  active?: boolean;
  /** The room or area it stands in; null takes it out. */
  parentId?: string | null;
  address?: string | null;
  description?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
}

const EMPTY = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

type Db = Prisma.TransactionClient;

/**
 * Runs a change to the locations in one transaction holding the
 * afrinov:location-tree lock, so its checks (one level, active rooms, never a
 * rack) and its write see the same locations: two edits at once cannot each
 * pass and together leave a rack inside a rack. The lock is released on commit
 * or rollback.
 */
function inTree<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:location-tree'))`;
    return fn(tx);
  });
}

async function assertCodeUnique(db: Db, code: string, excludeId?: string): Promise<void> {
  const existing = await db.location.findUnique({ where: { code } });
  if (existing && existing.id !== excludeId) {
    throw Errors.conflict(`Location code "${code}" is already in use.`);
  }
}

async function assertNameUnique(db: Db, name: string, excludeId?: string): Promise<void> {
  const existing = await db.location.findUnique({ where: { name } });
  if (existing && existing.id !== excludeId) {
    throw Errors.conflict(`Location name "${name}" already exists.`);
  }
}

/** What a location list or read shows of the room it stands in. */
const PARENT = { select: { id: true, name: true, code: true, type: true } } as const;

/**
 * Whether `parentId` can hold this location: it exists, is active, is not a
 * rack and is not itself inside another; and the location (absent when new)
 * is not itself and has nothing inside it. One level, so no loops.
 */
async function assertParent(db: Db, parentId: string, child?: { id: string }): Promise<void> {
  if (child && parentId === child.id) throw Errors.validation('A location cannot be inside itself.');
  const parent = await db.location.findUnique({ where: { id: parentId } });
  if (!parent) throw Errors.validation('The location it is inside does not exist.');
  if (!parent.active) throw Errors.validation(`${parent.name} is inactive. Reactivate it to put locations inside it.`);
  if (parent.type === 'RACK') throw Errors.validation(`${parent.name} is a rack. A location can be inside a room or area, not a rack.`);
  if (parent.parentId) throw Errors.validation(`${parent.name} is itself inside another location. Locations go one level deep: choose a room or area that is not inside another.`);
  if (child && (await db.location.count({ where: { parentId: child.id } })) > 0) {
    throw Errors.validation('This location has locations inside it, so it cannot go inside another. Move them out first.');
  }
}

/** Refuses to deactivate a room that still has active locations inside it. */
async function assertNoActiveChildren(db: Db, id: string, name: string): Promise<void> {
  const inside = await db.location.count({ where: { parentId: id, active: true } });
  if (inside > 0) {
    throw Errors.conflict(`${name} has ${inside} active location${inside === 1 ? '' : 's'} inside it. Move or deactivate them first.`, { locations: inside });
  }
}

/**
 * Refuses to activate a location inside an inactive room: stock could go onto
 * the rack while its room is closed. Reactivate the room first, or move it out.
 */
async function assertRoomActive(db: Db, name: string, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const room = await db.location.findUnique({ where: { id: parentId } });
  if (room && !room.active) {
    throw Errors.validation(`${name} is inside ${room.name}, which is inactive. Reactivate ${room.name} first, or move ${name} out of it.`);
  }
}

interface DependencyCounts {
  /** Locations standing inside this one. */
  locations: number;
  racks: number;
  goodsReceiptLines: number;
  inventoryTransactions: number;
  inventoryBalances: number;
}

async function dependencyCounts(db: Db, id: string): Promise<DependencyCounts> {
  const [locations, racks, goodsReceiptLines, inventoryTransactions, inventoryBalances] = await Promise.all([
    db.location.count({ where: { parentId: id } }),
    db.rack.count({ where: { locationId: id } }),
    db.goodsReceiptLine.count({ where: { locationId: id } }),
    db.inventoryTransaction.count({ where: { locationId: id } }),
    db.inventoryBalance.count({ where: { locationId: id } }),
  ]);
  return { locations, racks, goodsReceiptLines, inventoryTransactions, inventoryBalances };
}

function hasAnyDependency(c: DependencyCounts): boolean {
  return c.locations + c.racks + c.goodsReceiptLines + c.inventoryTransactions + c.inventoryBalances > 0;
}

export const LocationService = {
  async list(filter: { q?: string; type?: LocationType; active?: boolean; parentId?: string } = {}) {
    const where: Prisma.LocationWhereInput = {};
    if (filter.type) where.type = filter.type;
    // The locations inside one room or area.
    if (filter.parentId) where.parentId = filter.parentId;
    if (filter.active !== undefined) where.active = filter.active;
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { code: { contains: filter.q, mode: 'insensitive' } },
        { address: { contains: filter.q, mode: 'insensitive' } },
        { description: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.location.findMany({
      where,
      include: { parent: PARENT },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    const locationIds = rows.map((l) => l.id);
    const allBalances = locationIds.length
      ? await prisma.inventoryBalance.findMany({ where: { locationId: { in: locationIds } } })
      : [];
    const countMap = new Map<string, number>();
    for (const b of allBalances) {
      countMap.set(b.locationId, (countMap.get(b.locationId) ?? 0) + 1);
    }
    return rows.map((l) => ({ ...l, inventoryCount: countMap.get(l.id) ?? 0 }));
  },

  async getById(id: string) {
    const loc = await prisma.location.findUnique({ where: { id }, include: { parent: PARENT } });
    if (!loc) throw Errors.notFound('Location');
    const counts = await dependencyCounts(prisma, id);
    return { ...loc, inventoryCount: counts.inventoryBalances, dependencyCounts: counts };
  },

  async create(input: CreateLocationInput, actorId: string) {
    const name = input.name?.trim();
    if (!name) throw Errors.validation('Location name is required');
    const code = input.code?.trim() || null;
    const parentId = input.parentId || null;
    return inTree(async (tx) => {
      if (code) await assertCodeUnique(tx, code);
      await assertNameUnique(tx, name);
      if (parentId) await assertParent(tx, parentId);
      const data: Prisma.LocationUncheckedCreateInput = {
        name,
        code: code ?? null,
        type: input.type,
        active: input.active ?? true,
        parentId,
        address: input.address?.trim() || null,
        description: input.description?.trim() || null,
        contactPerson: input.contactPerson?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        contactEmail: input.contactEmail?.trim() || null,
        notes: input.notes?.trim() || null,
        createdById: actorId,
        updatedById: actorId,
      };
      const created = await tx.location.create({ data });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'Location',
          entityId: created.id,
          after: created as unknown as Prisma.InputJsonValue,
        },
      });
      return created;
    });
  },

  async update(input: UpdateLocationInput, actorId: string) {
    return inTree(async (tx) => {
      const before = await tx.location.findUnique({ where: { id: input.id } });
      if (!before) throw Errors.notFound('Location');

      const data: Prisma.LocationUncheckedUpdateInput = {};
      if (input.name !== undefined) {
        if (EMPTY(input.name)) throw Errors.validation('Location name is required');
        const next = input.name.trim();
        if (next !== before.name) await assertNameUnique(tx, next, before.id);
        data.name = next;
      }
      if (input.code !== undefined) {
        if (input.code === null || EMPTY(input.code)) {
          data.code = null;
        } else {
          const next = input.code.trim();
          if (next !== before.code) await assertCodeUnique(tx, next, before.id);
          data.code = next;
        }
      }
      if (input.type !== undefined) {
        // A room with locations inside it cannot become a rack: racks hold no locations.
        if (input.type === 'RACK' && before.type !== 'RACK' && (await tx.location.count({ where: { parentId: before.id } })) > 0) {
          throw Errors.validation('This location has locations inside it, so it cannot be a rack. Move them out first.');
        }
        data.type = input.type;
      }
      let parentId = before.parentId;
      if (input.parentId !== undefined && input.parentId !== before.parentId) {
        if (input.parentId) await assertParent(tx, input.parentId, before);
        parentId = input.parentId || null;
        data.parentId = parentId;
      }
      if (input.active !== undefined) {
        if (!input.active && before.active) await assertNoActiveChildren(tx, before.id, before.name);
        // A new room was checked active above; an unchanged one is checked here.
        if (input.active && !before.active && parentId === before.parentId) {
          await assertRoomActive(tx, (data.name as string | undefined) ?? before.name, parentId);
        }
        data.active = input.active;
      }
      if (input.address !== undefined) data.address = input.address === null ? null : input.address.trim() || null;
      if (input.description !== undefined) data.description = input.description === null ? null : input.description.trim() || null;
      if (input.contactPerson !== undefined) data.contactPerson = input.contactPerson === null ? null : input.contactPerson.trim() || null;
      if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone === null ? null : input.contactPhone.trim() || null;
      if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail === null ? null : input.contactEmail.trim() || null;
      if (input.notes !== undefined) data.notes = input.notes === null ? null : input.notes.trim() || null;
      data.updatedById = actorId;

      const after = await tx.location.update({ where: { id: input.id }, data });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'UPDATE',
          entityType: 'Location',
          entityId: input.id,
          before: before as unknown as Prisma.InputJsonValue,
          after: after as unknown as Prisma.InputJsonValue,
        },
      });
      return after;
    });
  },

  async setStatus(id: string, active: boolean, actorId: string) {
    return inTree(async (tx) => {
      const before = await tx.location.findUnique({ where: { id } });
      if (!before) throw Errors.notFound('Location');
      if (before.active === active) return before;
      if (!active) await assertNoActiveChildren(tx, id, before.name);
      else await assertRoomActive(tx, before.name, before.parentId);
      const after = await tx.location.update({
        where: { id },
        data: { active, updatedById: actorId },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: active ? 'ACTIVATE' : 'DEACTIVATE',
          entityType: 'Location',
          entityId: id,
          before: { active: before.active },
          after: { active },
        },
      });
      return after;
    });
  },

  async remove(id: string, actorId: string) {
    return inTree(async (tx) => {
      const loc = await tx.location.findUnique({ where: { id } });
      if (!loc) throw Errors.notFound('Location');
      const counts = await dependencyCounts(tx, id);
      if (counts.locations > 0) {
        // Deactivating would not help either while those are active: they have to move first.
        throw Errors.conflict(
          `${loc.name} has ${counts.locations} location${counts.locations === 1 ? '' : 's'} inside it. Move them out of it before deleting it.`,
          { dependencies: counts },
        );
      }
      if (hasAnyDependency(counts)) {
        throw Errors.conflict(
          'This location cannot be deleted because it is referenced by other records. Deactivate the location instead.',
          { dependencies: counts },
        );
      }
      await tx.location.delete({ where: { id } });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'DELETE',
          entityType: 'Location',
          entityId: id,
          before: loc as unknown as Prisma.InputJsonValue,
        },
      });
    });
  },
};
