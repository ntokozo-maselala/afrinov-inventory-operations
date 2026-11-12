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
import { ProjectScheduleService } from './project-schedule.service.js';
import { toolsOutOn } from '../../shared/inventory/tool-loans.js';

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
}

/** A project that takes no more work: its status says so, and it is inactive. */
export const isClosedStatus = (status: string): boolean => status === 'COMPLETED' || status === 'CANCELLED';

/** What has to be dealt with before a project can be completed or cancelled (system audit E1). */
export interface ClosingBlocker {
  kind: 'ORDER' | 'RFQ' | 'LOAN' | 'APPROVAL' | 'SCHEDULE';
  text: string;
  /** ORDER and RFQ: which one, to link to it. */
  id?: string;
}

/** An order not yet finished: its lines may still be bought or received. */
const OPEN_ORDER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'] as const;

/**
 * Orders still open, requests for quotation not yet awarded or cancelled,
 * tools still out on loan to it and write-offs of its stock waiting for
 * approval; and, to complete it, open schedules. Closing with any of these
 * left would land deliveries, loans or stock on a project that takes no more
 * work. Stock held for it is not in the way: once it is closed, Leftovers
 * moves that to Stores. Sales RFQs are prices asked for, never closed, so they
 * don't count.
 */
async function closingBlockers(projectNumber: string, to: 'COMPLETED' | 'CANCELLED', db: Prisma.TransactionClient): Promise<ClosingBlocker[]> {
  const [orders, rfqs, tools, waiting, schedules] = await Promise.all([
    db.purchaseOrder.findMany({ where: { projectNumber, status: { in: [...OPEN_ORDER_STATUSES] } }, select: { id: true, number: true, status: true }, orderBy: { number: 'asc' } }),
    db.rfq.findMany({ where: { projectNumber, status: { in: ['DRAFT', 'SENT'] } }, select: { id: true, number: true, status: true }, orderBy: { number: 'asc' } }),
    toolsOutOn(db, { projectNumber }),
    db.adjustmentRequest.count({ where: { status: 'PENDING', OR: [{ projectNumber }, { heldForProject: projectNumber }] } }),
    to === 'COMPLETED' ? ProjectScheduleService.openCount(projectNumber, db) : Promise.resolve(0),
  ]);
  const word = (s: string) => s.toLowerCase().replace('_', ' ');
  const blockers: ClosingBlocker[] = [
    ...orders.map((o): ClosingBlocker => ({ kind: 'ORDER', id: o.id, text: `Order ${o.number} is ${word(o.status)}: close, cancel or finish receiving it` })),
    ...rfqs.map((r): ClosingBlocker => ({ kind: 'RFQ', id: r.id, text: `Request for quotation ${r.number} is ${word(r.status)}: award or cancel it` })),
    ...tools.map((t): ClosingBlocker => ({ kind: 'LOAN', text: `${t.out.toString()} × ${t.sku} still out on loan to it: check them in` })),
  ];
  if (waiting > 0) blockers.push({ kind: 'APPROVAL', text: `${waiting} write-off${waiting === 1 ? '' : 's'} of its stock waiting for approval` });
  if (schedules > 0) blockers.push({ kind: 'SCHEDULE', text: `${schedules} open schedule${schedules === 1 ? '' : 's'}: finish or cancel ${schedules === 1 ? 'it' : 'them'}` });
  return blockers;
}

/**
 * Refuses to close a project until nothing still depends on it. Its row is
 * held FOR UPDATE; issuing, lending, ordering for it and changing its
 * schedules hold it FOR SHARE, so none can start between this check and the
 * change committing.
 */
async function assertClosable(projectNumber: string, to: 'COMPLETED' | 'CANCELLED', tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "projects" WHERE "project_number" = ${projectNumber} FOR UPDATE`;
  const blockers = await closingBlockers(projectNumber, to, tx);
  if (blockers.length > 0) {
    throw Errors.invalidState(`Project ${projectNumber} can't be ${to === 'COMPLETED' ? 'completed' : 'cancelled'} yet: ${blockers.map((b) => b.text).join('; ')}.`, { blockers });
  }
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

    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
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
          // Status decides (system audit E2): a project is active unless completed or cancelled.
          active: !isClosedStatus(input.status ?? 'PLANNING'),
        },
        include: { manager: { select: { id: true, name: true, email: true } } },
      });
      // The project row and its audit record commit together, so a change can
      // never be recorded without the history entry that explains it.
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'Project',
          entityId: project.projectNumber,
          after: project as unknown as Prisma.InputJsonValue,
        },
      });
      return project;
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
    if (input.status !== undefined) {
      data.status = input.status;
      // Status decides whether it is active (system audit E2).
      data.active = !isClosedStatus(input.status);
    }
    if (input.managerId !== undefined) {
      data.manager = input.managerId === null
        ? { disconnect: true }
        : { connect: { id: input.managerId } };
    }
    if (input.client !== undefined) data.client = input.client;
    if (input.startDate !== undefined) data.startDate = toDateOrNull(input.startDate);
    if (input.endDate !== undefined) data.endDate = toDateOrNull(input.endDate);
    if (input.notes !== undefined) data.notes = input.notes;

    const after = await prisma.$transaction(async (tx) => {
      // A project closes only when nothing still depends on it (system audit E1);
      // completing it also needs every schedule done or cancelled (ADR-032).
      if (input.status && isClosedStatus(input.status) && input.status !== before.status) {
        await assertClosable(input.projectNumber, input.status as 'COMPLETED' | 'CANCELLED', tx);
      }
      const project = await tx.project.update({
        where: { projectNumber: input.projectNumber },
        data,
        include: { manager: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'UPDATE',
          entityType: 'Project',
          entityId: input.projectNumber,
          before: before as unknown as Prisma.InputJsonValue,
          after: project as unknown as Prisma.InputJsonValue,
        },
      });
      return project;
    });
    return after;
  },

  /** What must be dealt with before the project can be completed or cancelled, for the screen to show first. */
  async closingCheck(projectNumber: string, to: 'COMPLETED' | 'CANCELLED'): Promise<{ blockers: ClosingBlocker[] }> {
    if (!(await prisma.project.findUnique({ where: { projectNumber }, select: { projectNumber: true } }))) throw Errors.notFound('Project');
    return { blockers: await closingBlockers(projectNumber, to, prisma as unknown as Prisma.TransactionClient) };
  },

  async archive(projectNumber: string, actorId: string) {
    const p = await prisma.project.findUnique({ where: { projectNumber } });
    if (!p) throw Errors.notFound('Project');
    const after = await prisma.$transaction(async (tx) => {
      // Archiving cancels it, so the same check applies (system audit E1).
      if (p.status !== 'CANCELLED') await assertClosable(projectNumber, 'CANCELLED', tx);
      const project = await tx.project.update({
        where: { projectNumber },
        data: { active: false, status: 'CANCELLED' },
        include: { manager: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'ARCHIVE',
          entityType: 'Project',
          entityId: projectNumber,
          before: { active: p.active, status: p.status },
          after: { active: false, status: 'CANCELLED' },
        },
      });
      return project;
    });
    return after;
  },
};