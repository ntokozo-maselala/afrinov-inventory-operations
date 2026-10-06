// Unit tests for RackService. Uses an in-memory fake Prisma to verify
// create/update/archive semantics without a real database.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RackStatus } from '@prisma/client';

type Rack = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  locationId: string | null;
  projectNumber: string | null;
  capacity: number | null;
  status: RackStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};
type Loc = { id: string; name: string; active: boolean };
type Proj = { projectNumber: string; name: string; active: boolean };
type AuditRow = { actorId: string; action: string; entityType: string; entityId: string };

const db = {
  racks: new Map<string, Rack>(),
  locations: new Map<string, Loc>(),
  projects: new Map<string, Proj>(),
  audit: [] as AuditRow[],
};
let counter = 0;
function nextId(): string { counter += 1; return `rack-${counter}`; }

vi.mock('../../shared/db.js', () => ({
  get prisma() { return makePrisma(); },
}));

function makePrisma(): unknown {
  return {
    rack: {
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) => {
        if (where.id) return db.racks.get(where.id) ?? null;
        if (where.code) return [...db.racks.values()].find((r) => r.code === where.code) ?? null;
        return null;
      },
      findMany: async ({ where }: { where?: { status?: RackStatus; locationId?: string; projectNumber?: string; OR?: unknown[] } }) => {
        let list = [...db.racks.values()];
        if (where?.status) list = list.filter((r) => r.status === where.status);
        if (where?.locationId) list = list.filter((r) => r.locationId === where.locationId);
        if (where?.projectNumber) list = list.filter((r) => r.projectNumber === where.projectNumber);
        return list;
      },
      create: async ({ data }: { data: Omit<Rack, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const r: Rack = { ...data, id: nextId(), createdAt: new Date(), updatedAt: new Date() };
        db.racks.set(r.id, r);
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Rack> }) => {
        const existing = db.racks.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        db.racks.set(where.id, updated);
        return updated;
      },
    },
    location: {
      findUnique: async ({ where }: { where: { id: string } }) => db.locations.get(where.id) ?? null,
    },
    project: {
      findUnique: async ({ where }: { where: { projectNumber: string } }) => db.projects.get(where.projectNumber) ?? null,
    },
    auditLogEntry: {
      create: async ({ data }: { data: AuditRow }) => { db.audit.push(data); return data; },
    },
  };
}

beforeEach(() => {
  db.racks.clear();
  db.locations.clear();
  db.projects.clear();
  db.audit.length = 0;
  counter = 0;
  db.locations.set('loc-1', { id: 'loc-1', name: 'Main', active: true });
  db.projects.set('PRJ-1', { projectNumber: 'PRJ-1', name: 'Test', active: true });
});

describe('RackService', () => {
  it('creates a rack and writes an audit entry', async () => {
    const { RackService } = await import('./rack.service.js');
    const r = await RackService.create({ code: 'R-1', name: 'Rack One', capacity: 50 }, 'user-1');
    expect(r.code).toBe('R-1');
    expect(r.status).toBe('ACTIVE');
    expect(db.audit.length).toBe(1);
    expect(db.audit[0]).toMatchObject({ action: 'CREATE', entityType: 'Rack', actorId: 'user-1' });
  });

  it('rejects duplicate code', async () => {
    const { RackService } = await import('./rack.service.js');
    await RackService.create({ code: 'R-1', name: 'A' }, 'user-1');
    await expect(RackService.create({ code: 'R-1', name: 'B' }, 'user-1')).rejects.toThrow(/code/i);
  });

  it('rejects invalid capacity', async () => {
    const { RackService } = await import('./rack.service.js');
    await expect(RackService.create({ code: 'R-2', name: 'X', capacity: -1 }, 'user-1')).rejects.toThrow(/capacity/i);
  });

  it('rejects unknown location', async () => {
    const { RackService } = await import('./rack.service.js');
    await expect(
      RackService.create({ code: 'R-3', name: 'X', locationId: 'nope' }, 'user-1'),
    ).rejects.toThrow(/Location not found/i);
  });

  it('rejects unknown project', async () => {
    const { RackService } = await import('./rack.service.js');
    await expect(
      RackService.create({ code: 'R-4', name: 'X', projectNumber: 'NOPE' }, 'user-1'),
    ).rejects.toThrow(/Project not found/i);
  });

  it('updates and archives a rack', async () => {
    const { RackService } = await import('./rack.service.js');
    const r = await RackService.create({ code: 'R-5', name: 'X' }, 'user-1');
    const updated = await RackService.update({ id: r.id, name: 'Renamed' }, 'user-1');
    expect(updated.name).toBe('Renamed');
    const archived = await RackService.archive(r.id, 'user-1');
    expect(archived.status).toBe('INACTIVE');
    expect(db.audit.find((a) => a.action === 'ARCHIVE')).toBeDefined();
  });

  it('throws when archiving a missing rack', async () => {
    const { RackService } = await import('./rack.service.js');
    await expect(RackService.archive('00000000-0000-0000-0000-000000000000', 'user-1')).rejects.toThrow();
  });
});