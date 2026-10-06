// Rack management service.
//
// A Rack is a physical storage position. It may belong to a Location
// (workshop/storeroom) and/or be assigned to a Project. The catalog field
// `capacity` is informational — current occupancy is computed from the
// inventory balances at the rack's location.
//
// All public methods validate references (location, project) and write an
// audit entry on create/update/delete so operational changes remain traceable.
import { Prisma, RackStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';

export interface CreateRackInput {
  code: string;
  name: string;
  description?: string;
  locationId?: string;
  projectNumber?: string;
  capacity?: number;
  status?: RackStatus;
  notes?: string;
}

export interface UpdateRackInput {
  id: string;
  name?: string;
  description?: string | null;
  locationId?: string | null;
  projectNumber?: string | null;
  capacity?: number | null;
  status?: RackStatus;
  notes?: string | null;
}

async function assertLocation(locationId: string | null | undefined): Promise<void> {
  if (!locationId) return;
  const loc = await prisma.location.findUnique({ where: { id: locationId } });
  if (!loc) throw Errors.notFound('Location');
}

async function assertProject(projectNumber: string | null | undefined): Promise<void> {
  if (!projectNumber) return;
  const proj = await prisma.project.findUnique({ where: { projectNumber } });
  if (!proj) throw Errors.notFound('Project');
}

export const RackService = {
  async list(filter: { q?: string; locationId?: string; projectNumber?: string; status?: RackStatus } = {}) {
    const where: Prisma.RackWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.locationId) where.locationId = filter.locationId;
    if (filter.projectNumber) where.projectNumber = filter.projectNumber;
    if (filter.q) {
      where.OR = [
        { code: { contains: filter.q, mode: 'insensitive' } },
        { name: { contains: filter.q, mode: 'insensitive' } },
        { description: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    return prisma.rack.findMany({
      where,
      include: { location: true, project: true },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });
  },

  async getById(id: string) {
    const rack = await prisma.rack.findUnique({
      where: { id },
      include: { location: true, project: true },
    });
    if (!rack) throw Errors.notFound('Rack');
    return rack;
  },

  async create(input: CreateRackInput, actorId: string) {
    const code = input.code.trim();
    const name = input.name.trim();
    if (!code) throw Errors.validation('Rack code is required');
    if (!name) throw Errors.validation('Rack name is required');
    if (input.capacity !== undefined && (input.capacity < 0 || !Number.isFinite(input.capacity))) {
      throw Errors.validation('Capacity must be a non-negative number');
    }
    await assertLocation(input.locationId);
    await assertProject(input.projectNumber);

    const existing = await prisma.rack.findUnique({ where: { code } });
    if (existing) throw Errors.conflict(`Rack code "${code}" is already in use.`);

    const created = await prisma.rack.create({
      data: {
        code,
        name,
        description: input.description?.trim() || null,
        locationId: input.locationId ?? null,
        projectNumber: input.projectNumber ?? null,
        capacity: input.capacity ?? null,
        status: input.status ?? RackStatus.ACTIVE,
        notes: input.notes?.trim() || null,
      },
      include: { location: true, project: true },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'CREATE',
        entityType: 'Rack',
        entityId: created.id,
        after: created as unknown as Prisma.InputJsonValue,
      },
    });
    return created;
  },

  async update(input: UpdateRackInput, actorId: string) {
    const before = await prisma.rack.findUnique({ where: { id: input.id } });
    if (!before) throw Errors.notFound('Rack');

    if (input.capacity !== undefined && input.capacity !== null && (input.capacity < 0 || !Number.isFinite(input.capacity))) {
      throw Errors.validation('Capacity must be a non-negative number');
    }
    if (input.locationId !== undefined && input.locationId !== null) {
      await assertLocation(input.locationId);
    }
    if (input.projectNumber !== undefined && input.projectNumber !== null) {
      await assertProject(input.projectNumber);
    }

    const data: Prisma.RackUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.locationId !== undefined) data.locationId = input.locationId;
    if (input.projectNumber !== undefined) data.projectNumber = input.projectNumber;
    if (input.capacity !== undefined) data.capacity = input.capacity;
    if (input.status !== undefined) data.status = input.status;
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

    const after = await prisma.rack.update({
      where: { id: input.id },
      data,
      include: { location: true, project: true },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'UPDATE',
        entityType: 'Rack',
        entityId: input.id,
        before: before as unknown as Prisma.InputJsonValue,
        after: after as unknown as Prisma.InputJsonValue,
      },
    });
    return after;
  },

  async archive(id: string, actorId: string) {
    // Operational records should never be hard-deleted (per 02-business-analysis/business-rules.md):
    // archive instead by transitioning to INACTIVE.
    const rack = await prisma.rack.findUnique({ where: { id } });
    if (!rack) throw Errors.notFound('Rack');
    const after = await prisma.rack.update({
      where: { id },
      data: { status: RackStatus.INACTIVE },
      include: { location: true, project: true },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'ARCHIVE',
        entityType: 'Rack',
        entityId: id,
        before: { status: rack.status },
        after: { status: RackStatus.INACTIVE },
      },
    });
    return after;
  },
};