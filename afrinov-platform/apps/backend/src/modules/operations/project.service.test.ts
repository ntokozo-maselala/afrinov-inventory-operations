// Unit tests for ProjectService.
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  };
}

beforeEach(() => {
  db.projects.clear();
  db.users.clear();
  db.audit.length = 0;
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