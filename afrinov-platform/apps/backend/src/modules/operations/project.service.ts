// Project management service.
//
// The Project entity already exists in the schema as a reference target for
// inventory transactions (`projectNumber`). This service extends it with a
// full project master: name, code, status, dates, manager (FK to User),
// client, and notes. `projectNumber` remains the canonical primary key so
// existing transaction references keep working.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';

export const PROJECT_STATUSES: ProjectStatus[] = [
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
];

export interface CreateProjectInput {
  projectNumber: string;
  name: string;
  code?: string;
  description?: string;
  status?: ProjectStatus;
  managerId?: string;
  client?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  active?: boolean;
}

export interface UpdateProjectInput {
  projectNumber: string;
  name?: string;
  code?: string | null;
  description?: string | null;
  status?: ProjectStatus;
  managerId?: string | null;
  client?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  active?: boolean;
}

function toDateOrNull(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw Errors.validation('Invalid date');
  return d;
}

function validateDates(start?: string | null, end?: string | null): void {
  if (start && end) {
    if (new Date(end).getTime() < new Date(start).getTime()) {
      throw Errors.validation('End date cannot be earlier than start date');
    }
  }
}

export const ProjectService = {
  async list(filter: { q?: string; status?: ProjectStatus; active?: boolean } = {}) {
    const where: Prisma.ProjectWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.active !== undefined) where.active = filter.active;
    if (filter.q) {
      where.OR = [
        { projectNumber: { contains: filter.q, mode: 'insensitive' } },
        { name: { contains: filter.q, mode: 'insensitive' } },
        { code: { contains: filter.q, mode: 'insensitive' } },
        { client: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    return prisma.project.findMany({
      where,
      include: { manager: { select: { id: true, name: true, email: true } } },
      orderBy: [{ active: 'desc' }, { startDate: 'desc' }, { projectNumber: 'asc' }],
    });
  },

  async getById(projectNumber: string) {
    const p = await prisma.project.findUnique({
      where: { projectNumber },
      include: { manager: { select: { id: true, name: true, email: true } } },
    });
    if (!p) throw Errors.notFound('Project');
    return p;
  },

  async create(input: CreateProjectInput, actorId: string) {
    const projectNumber = input.projectNumber.trim();
    const name = input.name.trim();
    if (!projectNumber) throw Errors.validation('Project number is required');
    if (!name) throw Errors.validation('Project name is required');
    if (input.endDate && input.startDate && new Date(input.endDate).getTime() < new Date(input.startDate).getTime()) {
      throw Errors.validation('End date cannot be earlier than start date');
    }
    validateDates(input.startDate, input.endDate);

    if (input.code) {
      const existing = await prisma.project.findFirst({ where: { code: input.code } });
      if (existing) throw Errors.conflict(`Project code "${input.code}" is already in use.`);
    }

    const created = await prisma.project.create({
      data: {
        projectNumber,
        name,
        code: input.code ?? null,
        description: input.description ?? null,
        status: input.status ?? 'PLANNING',
        managerId: input.managerId ?? null,
        client: input.client ?? null,
        startDate: toDateOrNull(input.startDate),
        endDate: toDateOrNull(input.endDate),
        notes: input.notes ?? null,
        active: input.active ?? true,
      },
      include: { manager: { select: { id: true, name: true, email: true } } },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'CREATE',
        entityType: 'Project',
        entityId: created.projectNumber,
        after: created as unknown as Prisma.InputJsonValue,
      },
    });
    return created;
  },

  async update(input: UpdateProjectInput, actorId: string) {
    const before = await prisma.project.findUnique({ where: { projectNumber: input.projectNumber } });
    if (!before) throw Errors.notFound('Project');

    if (input.endDate !== undefined && input.startDate !== undefined) {
      validateDates(input.startDate, input.endDate);
    } else if (input.endDate !== undefined && input.endDate && before.startDate) {
      validateDates(before.startDate.toISOString(), input.endDate);
    } else if (input.startDate !== undefined && input.startDate && before.endDate) {
      validateDates(input.startDate, before.endDate.toISOString());
    }

    if (input.code) {
      const dup = await prisma.project.findFirst({
        where: { code: input.code, NOT: { projectNumber: input.projectNumber } },
      });
      if (dup) throw Errors.conflict(`Project code "${input.code}" is already in use.`);
    }

    const data: Prisma.ProjectUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.code !== undefined) data.code = input.code || null;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;
    if (input.managerId !== undefined) {
      data.manager = input.managerId === null
        ? { disconnect: true }
        : { connect: { id: input.managerId } };
    }
    if (input.client !== undefined) data.client = input.client;
    if (input.startDate !== undefined) data.startDate = toDateOrNull(input.startDate);
    if (input.endDate !== undefined) data.endDate = toDateOrNull(input.endDate);
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.active !== undefined) data.active = input.active;

    const after = await prisma.project.update({
      where: { projectNumber: input.projectNumber },
      data,
      include: { manager: { select: { id: true, name: true, email: true } } },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'UPDATE',
        entityType: 'Project',
        entityId: input.projectNumber,
        before: before as unknown as Prisma.InputJsonValue,
        after: after as unknown as Prisma.InputJsonValue,
      },
    });
    return after;
  },

  async archive(projectNumber: string, actorId: string) {
    const p = await prisma.project.findUnique({ where: { projectNumber } });
    if (!p) throw Errors.notFound('Project');
    const after = await prisma.project.update({
      where: { projectNumber },
      data: { active: false, status: 'CANCELLED' },
      include: { manager: { select: { id: true, name: true, email: true } } },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'ARCHIVE',
        entityType: 'Project',
        entityId: projectNumber,
        before: { active: p.active, status: p.status },
        after: { active: false, status: 'CANCELLED' },
      },
    });
    return after;
  },
};