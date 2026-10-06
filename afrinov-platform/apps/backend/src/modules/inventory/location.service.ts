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
import { Prisma, type LocationType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';

export interface CreateLocationInput {
  name: string;
  code?: string;
  type: LocationType;
  active?: boolean;
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
  address?: string | null;
  description?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
}

const EMPTY = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

async function assertCodeUnique(code: string, excludeId?: string): Promise<void> {
  const existing = await prisma.location.findUnique({ where: { code } });
  if (existing && existing.id !== excludeId) {
    throw Errors.conflict(`Location code "${code}" is already in use.`);
  }
}

async function assertNameUnique(name: string, excludeId?: string): Promise<void> {
  const existing = await prisma.location.findUnique({ where: { name } });
  if (existing && existing.id !== excludeId) {
    throw Errors.conflict(`Location name "${name}" already exists.`);
  }
}

interface DependencyCounts {
  racks: number;
  goodsReceiptLines: number;
  inventoryTransactions: number;
  inventoryBalances: number;
}

async function dependencyCounts(id: string): Promise<DependencyCounts> {
  const [racks, goodsReceiptLines, inventoryTransactions, inventoryBalances] = await Promise.all([
    prisma.rack.count({ where: { locationId: id } }),
    prisma.goodsReceiptLine.count({ where: { locationId: id } }),
    prisma.inventoryTransaction.count({ where: { locationId: id } }),
    prisma.inventoryBalance.count({ where: { locationId: id } }),
  ]);
  return { racks, goodsReceiptLines, inventoryTransactions, inventoryBalances };
}

function hasAnyDependency(c: DependencyCounts): boolean {
  return c.racks + c.goodsReceiptLines + c.inventoryTransactions + c.inventoryBalances > 0;
}

export const LocationService = {
  async list(filter: { q?: string; type?: LocationType; active?: boolean } = {}) {
    const where: Prisma.LocationWhereInput = {};
    if (filter.type) where.type = filter.type;
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
    const loc = await prisma.location.findUnique({ where: { id } });
    if (!loc) throw Errors.notFound('Location');
    const counts = await dependencyCounts(id);
    return { ...loc, inventoryCount: counts.inventoryBalances, dependencyCounts: counts };
  },

  async create(input: CreateLocationInput, actorId: string) {
    const name = input.name?.trim();
    if (!name) throw Errors.validation('Location name is required');
    const code = input.code?.trim() || null;
    if (code) await assertCodeUnique(code);
    await assertNameUnique(name);
    const data: Prisma.LocationUncheckedCreateInput = {
      name,
      code: code ?? null,
      type: input.type,
      active: input.active ?? true,
      address: input.address?.trim() || null,
      description: input.description?.trim() || null,
      contactPerson: input.contactPerson?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      contactEmail: input.contactEmail?.trim() || null,
      notes: input.notes?.trim() || null,
      createdById: actorId,
      updatedById: actorId,
    };
    const created = await prisma.location.create({ data });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'CREATE',
        entityType: 'Location',
        entityId: created.id,
        after: created as unknown as Prisma.InputJsonValue,
      },
    });
    return created;
  },

  async update(input: UpdateLocationInput, actorId: string) {
    const before = await prisma.location.findUnique({ where: { id: input.id } });
    if (!before) throw Errors.notFound('Location');

    const data: Prisma.LocationUncheckedUpdateInput = {};
    if (input.name !== undefined) {
      if (EMPTY(input.name)) throw Errors.validation('Location name is required');
      const next = input.name.trim();
      if (next !== before.name) await assertNameUnique(next, before.id);
      data.name = next;
    }
    if (input.code !== undefined) {
      if (input.code === null || EMPTY(input.code)) {
        data.code = null;
      } else {
        const next = input.code.trim();
        if (next !== before.code) await assertCodeUnique(next, before.id);
        data.code = next;
      }
    }
    if (input.type !== undefined) data.type = input.type;
    if (input.active !== undefined) data.active = input.active;
    if (input.address !== undefined) data.address = input.address === null ? null : input.address.trim() || null;
    if (input.description !== undefined) data.description = input.description === null ? null : input.description.trim() || null;
    if (input.contactPerson !== undefined) data.contactPerson = input.contactPerson === null ? null : input.contactPerson.trim() || null;
    if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone === null ? null : input.contactPhone.trim() || null;
    if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail === null ? null : input.contactEmail.trim() || null;
    if (input.notes !== undefined) data.notes = input.notes === null ? null : input.notes.trim() || null;
    data.updatedById = actorId;

    const after = await prisma.location.update({ where: { id: input.id }, data });
    await prisma.auditLogEntry.create({
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
  },

  async setStatus(id: string, active: boolean, actorId: string) {
    const before = await prisma.location.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Location');
    if (before.active === active) return before;
    const after = await prisma.location.update({
      where: { id },
      data: { active, updatedById: actorId },
    });
    await prisma.auditLogEntry.create({
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
  },

  async remove(id: string, actorId: string) {
    const loc = await prisma.location.findUnique({ where: { id } });
    if (!loc) throw Errors.notFound('Location');
    const counts = await dependencyCounts(id);
    if (hasAnyDependency(counts)) {
      throw Errors.conflict(
        'This location cannot be deleted because it is referenced by other records. Deactivate the location instead.',
        { dependencies: counts },
      );
    }
    await prisma.location.delete({ where: { id } });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'DELETE',
        entityType: 'Location',
        entityId: id,
        before: loc as unknown as Prisma.InputJsonValue,
      },
    });
  },
};
