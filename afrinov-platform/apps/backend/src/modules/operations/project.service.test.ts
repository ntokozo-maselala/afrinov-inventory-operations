// Unit tests for ProjectService.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Proj = {
  projectNumber: string;
  name: string | null;
  code: string | null;
  description: string | null;
  status: string;
  managerId: string | null;
  client: string | null;
  startDate: Date | null;
  endDate: Date | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};
type User = { id: string; name: string; email: string };
type AuditRow = { actorId: string; action: string; entityType: string; entityId: string };

const db = {
  projects: new Map<string, Proj>(),
  users: new Map<string, User>(),
  audit: [] as AuditRow[],
  schedules: [] as Array<{ projectNumber: string; status: string }>,
  orders: [] as Array<{ id: string; number: string; status: string; projectNumber: string }>,
  rfqs: [] as Array<{ id: string; number: string; status: string; projectNumber: string }>,
  loans: [] as Array<{ id: string; materialId: string; sku: string; projectNumber: string; lent: number; back: number }>,
  waiting: new Map<string, number>(),
  locks: 0,
};

vi.mock('../../shared/db.js', () => ({
  get prisma() { return makePrisma(); },
}));

function makePrisma(): unknown {
  return {
    project: {
      findUnique: async ({ where, include }: { where: { projectNumber: string }; include?: unknown }) => {
        const p = db.projects.get(where.projectNumber);
        if (!p) return null;
        if (include && (include as { manager?: boolean }).manager) {
          return { ...p, manager: p.managerId ? db.users.get(p.managerId) ?? null : null };
        }
        return p;
      },
      findFirst: async ({ where }: { where: { code?: string; NOT?: { projectNumber: string } } }) => {
        return [...db.projects.values()].find((p) => {
          if (where.code && p.code !== where.code) return false;
          if (where.NOT && p.projectNumber === where.NOT.projectNumber) return false;
          return true;
        }) ?? null;
      },
      findMany: async ({ where }: { where?: { status?: string; active?: boolean; OR?: unknown[] } }) => {
        let list = [...db.projects.values()];
        if (where?.status) list = list.filter((p) => p.status === where.status);
        if (where?.active !== undefined) list = list.filter((p) => p.active === where.active);
        return list;
      },
      create: async ({ data, include }: { data: Omit<Proj, 'createdAt' | 'updatedAt'>; include?: unknown }) => {
        const p: Proj = { ...data, createdAt: new Date(), updatedAt: new Date() };
        db.projects.set(p.projectNumber, p);
        if (include && (include as { manager?: boolean }).manager) {
          return { ...p, manager: p.managerId ? db.users.get(p.managerId) ?? null : null };
        }
        return p;
      },
      update: async ({ where, data, include }: { where: { projectNumber: string }; data: Partial<Proj> | { manager?: { connect?: { id: string }; disconnect?: boolean } }; include?: unknown }) => {
        const existing = db.projects.get(where.projectNumber);
        if (!existing) throw new Error('not found');
        const flatData = data as Partial<Proj> & { manager?: { connect?: { id: string }; disconnect?: boolean } };
        const managerId = flatData.managerId !== undefined
          ? flatData.managerId
          : flatData.manager?.connect?.id !== undefined
            ? flatData.manager.connect.id
            : flatData.manager?.disconnect === true
              ? null
              : existing.managerId;
        const updated: Proj = {
          ...existing,
          ...flatData,
          managerId,
          startDate: flatData.startDate !== undefined ? flatData.startDate : existing.startDate,
          endDate: flatData.endDate !== undefined ? flatData.endDate : existing.endDate,
          updatedAt: new Date(),
        };
        delete (updated as { manager?: unknown }).manager;
        db.projects.set(where.projectNumber, updated);
        if (include && (include as { manager?: boolean }).manager) {
          return { ...updated, manager: updated.managerId ? db.users.get(updated.managerId) ?? null : null };
        }
        return updated;
      },
    },
    auditLogEntry: {
      create: async ({ data }: { data: AuditRow }) => { db.audit.push(data); return data; },
    },
    purchaseOrder: {
      findMany: async ({ where }: { where: { projectNumber: string; status: { in: string[] } } }) =>
        db.orders.filter((o) => o.projectNumber === where.projectNumber && where.status.in.includes(o.status)),
    },
    rfq: {
      findMany: async ({ where }: { where: { projectNumber: string; status: { in: string[] } } }) =>
        db.rfqs.filter((r) => r.projectNumber === where.projectNumber && where.status.in.includes(r.status)),
    },
    inventoryTransaction: {
      findMany: async ({ where }: { where: { projectNumber?: string } }) => db.loans
        .filter((l) => l.projectNumber === where.projectNumber)
        .map((l) => ({ id: l.id, materialId: l.materialId, quantity: new Prisma.Decimal(-l.lent), material: { sku: l.sku } })),
      groupBy: async ({ where }: { where: { referenceId: { in: string[] } } }) => db.loans
        .filter((l) => where.referenceId.in.includes(l.id))
        .map((l) => ({ referenceId: l.id, _sum: { quantity: new Prisma.Decimal(l.back) } })),
    },
    adjustmentRequest: {
      count: async ({ where }: { where: { OR: Array<{ projectNumber?: string; heldForProject?: string }> } }) =>
        db.waiting.get(where.OR[0]!.projectNumber ?? '') ?? 0,
    },
    projectSchedule: {
      count: async ({ where }: { where: { projectNumber: string; status: { in: string[] } } }) =>
        db.schedules.filter((s) => s.projectNumber === where.projectNumber && where.status.in.includes(s.status)).length,
    },
    // The service wraps each mutation and its audit write in one transaction;
    // the mock runs the callback against the same in-memory client.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
    // The row lock taken before counting open schedules.
    $queryRaw: async () => { db.locks += 1; return []; },
  };
}

beforeEach(() => {
  db.projects.clear();
  db.users.clear();
  db.audit.length = 0;
  db.schedules.length = 0;
  db.orders.length = 0;
  db.rfqs.length = 0;
  db.loans.length = 0;
  db.waiting.clear();
  db.locks = 0;
  db.users.set('user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' });
  db.users.set('user-2', { id: 'user-2', name: 'Bob', email: 'bob@example.com' });
});

describe('ProjectService', () => {
  it('creates a project and writes audit', async () => {
    const { ProjectService } = await import('./project.service.js');
    const p = await ProjectService.create({
      projectNumber: 'PRJ-100',
      name: 'Test project',
      code: 'TP-100',
    }, 'user-1');
    expect(p.projectNumber).toBe('PRJ-100');
    expect(p.status).toBe('PLANNING');
    expect(p.active).toBe(true);
    expect(db.audit[0]).toMatchObject({ action: 'CREATE', entityType: 'Project' });
  });

  it('rejects duplicate code', async () => {
    const { ProjectService } = await import('./project.service.js');
    await ProjectService.create({ projectNumber: 'P-1', name: 'A', code: 'ABC' }, 'user-1');
    await expect(
      ProjectService.create({ projectNumber: 'P-2', name: 'B', code: 'ABC' }, 'user-1'),
    ).rejects.toThrow(/code/i);
  });

  it('rejects end date earlier than start date', async () => {
    const { ProjectService } = await import('./project.service.js');
    await expect(
      ProjectService.create({
        projectNumber: 'P-3',
        name: 'X',
        startDate: '2026-09-10',
        endDate: '2026-09-01',
      }, 'user-1'),
    ).rejects.toThrow(/end date/i);
  });

  it('updates and archives', async () => {
    const { ProjectService } = await import('./project.service.js');
    await ProjectService.create({ projectNumber: 'P-4', name: 'X' }, 'user-1');
    const updated = await ProjectService.update({ projectNumber: 'P-4', name: 'Renamed', managerId: 'user-2' }, 'user-1');
    expect(updated.name).toBe('Renamed');
    expect(updated.managerId).toBe('user-2');
    const archived = await ProjectService.archive('P-4', 'user-1');
    expect(archived.active).toBe(false);
    expect(archived.status).toBe('CANCELLED');
  });

  it('refuses Completed while a schedule is open, and allows it once every schedule is closed', async () => {
    const { ProjectService } = await import('./project.service.js');
    await ProjectService.create({ projectNumber: 'P-7', name: 'X', status: 'ACTIVE' }, 'user-1');
    db.schedules.push({ projectNumber: 'P-7', status: 'DONE' }, { projectNumber: 'P-7', status: 'ACTIVE' });
    await expect(ProjectService.update({ projectNumber: 'P-7', status: 'COMPLETED' }, 'user-1')).rejects.toThrow(/1 open schedule/);
    // Counted with the project's row locked, inside the update's transaction.
    expect(db.locks).toBe(1);
    db.schedules[1]!.status = 'CANCELLED';
    expect((await ProjectService.update({ projectNumber: 'P-7', status: 'COMPLETED' }, 'user-1')).status).toBe('COMPLETED');
  });

  // System audit E1: a project closes only when nothing still depends on it.
  it('refuses closing while orders, RFQs, tool loans or write-offs remain, and lists them', async () => {
    const { ProjectService } = await import('./project.service.js');
    await ProjectService.create({ projectNumber: 'P-8', name: 'X', status: 'ACTIVE' }, 'user-1');
    db.orders.push({ id: 'po-1', number: 'AFRI-0101', status: 'APPROVED', projectNumber: 'P-8' }, { id: 'po-2', number: 'AFRI-0102', status: 'RECEIVED', projectNumber: 'P-8' });
    db.rfqs.push({ id: 'rfq-1', number: 'AFRI-02A-0008-01', status: 'SENT', projectNumber: 'P-8' });
    db.loans.push({ id: 'loan-1', materialId: 't1', sku: 'GRINDER-01', projectNumber: 'P-8', lent: 1, back: 0 });
    db.waiting.set('P-8', 2);
    const { blockers } = await ProjectService.closingCheck('P-8', 'CANCELLED');
    expect(blockers.map((b) => b.kind)).toEqual(['ORDER', 'RFQ', 'LOAN', 'APPROVAL']);
    expect(blockers[0]).toMatchObject({ id: 'po-1', text: expect.stringMatching(/AFRI-0101 is approved/) });
    await expect(ProjectService.update({ projectNumber: 'P-8', status: 'CANCELLED' }, 'user-1')).rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringMatching(/can't be cancelled yet/) });
    await expect(ProjectService.archive('P-8', 'user-1')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(db.projects.get('P-8')).toMatchObject({ status: 'ACTIVE', active: true });

    db.orders[0]!.status = 'CLOSED';
    db.rfqs[0]!.status = 'AWARDED';
    db.loans[0]!.back = 1;
    db.waiting.clear();
    expect((await ProjectService.update({ projectNumber: 'P-8', status: 'CANCELLED' }, 'user-1'))).toMatchObject({ status: 'CANCELLED', active: false });
  });

  // System audit E2: status decides whether a project is active.
  it('keeps active in step with status, both ways', async () => {
    const { ProjectService } = await import('./project.service.js');
    await ProjectService.create({ projectNumber: 'P-9', name: 'X', status: 'ACTIVE' }, 'user-1');
    expect((await ProjectService.update({ projectNumber: 'P-9', status: 'COMPLETED' }, 'user-1')).active).toBe(false);
    expect((await ProjectService.update({ projectNumber: 'P-9', status: 'ACTIVE' }, 'user-1')).active).toBe(true);
    expect((await ProjectService.update({ projectNumber: 'P-9', status: 'ON_HOLD' }, 'user-1')).active).toBe(true);
    expect((await ProjectService.create({ projectNumber: 'P-10', name: 'Y', status: 'CANCELLED' }, 'user-1')).active).toBe(false);
  });

  it('disconnects manager when null passed', async () => {
    const { ProjectService } = await import('./project.service.js');
    await ProjectService.create({ projectNumber: 'P-5', name: 'X', managerId: 'user-1' }, 'user-1');
    const updated = await ProjectService.update({ projectNumber: 'P-5', managerId: null }, 'user-1');
    expect(updated.managerId).toBeNull();
  });

  it('throws when not found', async () => {
    const { ProjectService } = await import('./project.service.js');
    await expect(ProjectService.getById('NOPE')).rejects.toThrow(/Project not found/i);
  });

  it('rejects empty name', async () => {
    const { ProjectService } = await import('./project.service.js');
    await expect(
      ProjectService.create({ projectNumber: 'P-6', name: '   ' }, 'user-1'),
    ).rejects.toThrow(/name/i);
  });
});