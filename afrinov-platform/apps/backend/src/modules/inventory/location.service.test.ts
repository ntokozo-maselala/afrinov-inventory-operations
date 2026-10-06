// Unit tests for LocationService. Uses an in-memory fake Prisma to verify
// list/create/update/status/delete semantics without a real database.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LocationType } from '@prisma/client';

type Loc = {
  id: string;
  name: string;
  code: string | null;
  type: LocationType;
  active: boolean;
  address: string | null;
  description: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Rack = { id: string; locationId: string | null };
type Grl = { id: string; locationId: string };
type InvTx = { id: string; locationId: string };
type InvBal = { materialId: string; locationId: string; quantity: number };

type AuditRow = { actorId: string; action: string; entityType: string; entityId: string };

const db = {
  locations: new Map<string, Loc>(),
  racks: new Map<string, Rack>(),
  grls: new Map<string, Grl>(),
  invTxs: new Map<string, InvTx>(),
  invBal: new Map<string, InvBal>(),
  audit: [] as AuditRow[],
};
let counter = 0;
function nextId(): string { counter += 1; return `loc-${counter}`; }
function balKey(materialId: string, locationId: string): string { return `${materialId}|${locationId}`; }

vi.mock('../../shared/db.js', () => ({
  get prisma() { return makePrisma(); },
}));

function makePrisma(): unknown {
  return {
    location: {
      findUnique: async ({ where }: { where: { id?: string; name?: string; code?: string | null } }) => {
        if (where.id) return db.locations.get(where.id) ?? null;
        if (where.name) return [...db.locations.values()].find((l) => l.name === where.name) ?? null;
        if (where.code !== undefined) return [...db.locations.values()].find((l) => l.code === where.code) ?? null;
        return null;
      },
      findMany: async ({ where }: { where?: { type?: LocationType; active?: boolean; OR?: unknown[] } }) => {
        let list = [...db.locations.values()];
        if (where?.type) list = list.filter((l) => l.type === where.type);
        if (where?.active !== undefined) list = list.filter((l) => l.active === where.active);
        if (where?.OR && Array.isArray(where.OR)) {
          list = list.filter((l) => (where.OR as Array<Record<string, unknown>>).some((cond) => {
            for (const [field, val] of Object.entries(cond)) {
              const needle = String((val as { contains?: string }).contains ?? '').toLowerCase();
              if (!needle) continue;
              const fieldVal = String((l as unknown as Record<string, unknown>)[field] ?? '').toLowerCase();
              if (fieldVal.includes(needle)) return true;
            }
            return false;
          }));
        }
        return list;
      },
      create: async ({ data }: { data: Omit<Loc, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const l: Loc = { ...data, id: nextId(), createdAt: new Date(), updatedAt: new Date() };
        db.locations.set(l.id, l);
        return l;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Loc> }) => {
        const existing = db.locations.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        db.locations.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const existing = db.locations.get(where.id);
        if (!existing) throw new Error('not found');
        db.locations.delete(where.id);
        return existing;
      },
      count: async () => db.locations.size,
    },
    rack: {
      count: async ({ where }: { where: { locationId: string } }) =>
        [...db.racks.values()].filter((r) => r.locationId === where.locationId).length,
    },
    goodsReceiptLine: {
      count: async ({ where }: { where: { locationId: string } }) =>
        [...db.grls.values()].filter((g) => g.locationId === where.locationId).length,
    },
    inventoryTransaction: {
      count: async ({ where }: { where: { locationId: string } }) =>
        [...db.invTxs.values()].filter((t) => t.locationId === where.locationId).length,
    },
    inventoryBalance: {
      findMany: async ({ where }: { where?: { locationId?: { in?: string[] } } }) =>
        where?.locationId?.in
          ? [...db.invBal.values()].filter((b) => where.locationId!.in!.includes(b.locationId))
          : [...db.invBal.values()],
      count: async ({ where }: { where: { locationId: string } }) =>
        [...db.invBal.values()].filter((b) => b.locationId === where.locationId).length,
    },
    auditLogEntry: {
      create: async ({ data }: { data: AuditRow }) => { db.audit.push(data); return data; },
    },
  };
}

beforeEach(() => {
  db.locations.clear();
  db.racks.clear();
  db.grls.clear();
  db.invTxs.clear();
  db.invBal.clear();
  db.audit.length = 0;
  counter = 0;
});

describe('LocationService', () => {
  it('creates a location and writes an audit entry', async () => {
    const { LocationService } = await import('./location.service.js');
    const l = await LocationService.create(
      { name: 'Main Storeroom', code: 'WH-01', type: 'STOREROOM' },
      'user-1',
    );
    expect(l.name).toBe('Main Storeroom');
    expect(l.code).toBe('WH-01');
    expect(l.active).toBe(true);
    expect(db.audit.length).toBe(1);
    expect(db.audit[0]).toMatchObject({ action: 'CREATE', entityType: 'Location', actorId: 'user-1' });
  });

  it('rejects missing name', async () => {
    const { LocationService } = await import('./location.service.js');
    await expect(
      LocationService.create({ name: '   ', type: 'STOREROOM' }, 'user-1'),
    ).rejects.toThrow(/name is required/i);
  });

  it('rejects duplicate name', async () => {
    const { LocationService } = await import('./location.service.js');
    await LocationService.create({ name: 'A', type: 'STOREROOM' }, 'user-1');
    await expect(LocationService.create({ name: 'A', type: 'RACK' }, 'user-1')).rejects.toThrow(/already exists/i);
  });

  it('rejects duplicate code', async () => {
    const { LocationService } = await import('./location.service.js');
    await LocationService.create({ name: 'A', code: 'WH-01', type: 'STOREROOM' }, 'user-1');
    await expect(
      LocationService.create({ name: 'B', code: 'WH-01', type: 'RACK' }, 'user-1'),
    ).rejects.toThrow(/code/i);
  });

  it('updates a location and audits changed fields', async () => {
    const { LocationService } = await import('./location.service.js');
    const l = await LocationService.create({ name: 'A', type: 'STOREROOM' }, 'user-1');
    const updated = await LocationService.update({ id: l.id, name: 'Renamed', address: '12 Park Lane' }, 'user-2');
    expect(updated.name).toBe('Renamed');
    expect(updated.address).toBe('12 Park Lane');
    const upd = db.audit.find((a) => a.action === 'UPDATE');
    expect(upd).toBeDefined();
    expect(upd?.actorId).toBe('user-2');
  });

  it('sets status and audits the transition', async () => {
    const { LocationService } = await import('./location.service.js');
    const l = await LocationService.create({ name: 'A', type: 'STOREROOM' }, 'user-1');
    const off = await LocationService.setStatus(l.id, false, 'user-2');
    expect(off.active).toBe(false);
    expect(db.audit.some((a) => a.action === 'DEACTIVATE')).toBe(true);
    const back = await LocationService.setStatus(l.id, true, 'user-2');
    expect(back.active).toBe(true);
    expect(db.audit.some((a) => a.action === 'ACTIVATE')).toBe(true);
  });

  it('blocks deletion when dependencies exist (racks, GR lines, transactions, balances)', async () => {
    const { LocationService } = await import('./location.service.js');
    const l = await LocationService.create({ name: 'A', type: 'STOREROOM' }, 'user-1');
    db.racks.set('r-1', { id: 'r-1', locationId: l.id });
    await expect(LocationService.remove(l.id, 'user-1')).rejects.toThrow(/cannot be deleted/i);
  });

  it('blocks deletion when only inventory balances reference the location', async () => {
    const { LocationService } = await import('./location.service.js');
    const l = await LocationService.create({ name: 'A', type: 'STOREROOM' }, 'user-1');
    db.invBal.set(balKey('m-1', l.id), { materialId: 'm-1', locationId: l.id, quantity: 5 });
    await expect(LocationService.remove(l.id, 'user-1')).rejects.toThrow(/cannot be deleted/i);
  });

  it('allows deletion when no dependencies exist and writes a DELETE audit', async () => {
    const { LocationService } = await import('./location.service.js');
    const l = await LocationService.create({ name: 'A', type: 'STOREROOM' }, 'user-1');
    await LocationService.remove(l.id, 'user-1');
    expect(db.locations.has(l.id)).toBe(false);
    expect(db.audit.some((a) => a.action === 'DELETE')).toBe(true);
  });

  it('throws NOT_FOUND on missing id', async () => {
    const { LocationService } = await import('./location.service.js');
    await expect(LocationService.getById('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not found/i);
    await expect(LocationService.remove('00000000-0000-0000-0000-000000000000', 'u')).rejects.toThrow(/not found/i);
  });

  it('filters list by q / type / active', async () => {
    const { LocationService } = await import('./location.service.js');
    await LocationService.create({ name: 'Main Storeroom', code: 'WH-01', type: 'STOREROOM' }, 'user-1');
    await LocationService.create({ name: 'Boiler Shop', code: 'BS-01', type: 'SHOP_FLOOR_AREA' }, 'user-1');
    const l3 = await LocationService.create({ name: 'Old Container', type: 'CONTAINER' }, 'user-1');
    await LocationService.setStatus(l3.id, false, 'user-1');

    const all = await LocationService.list();
    expect(all.length).toBe(3);
    const onlyStoreroom = await LocationService.list({ type: 'STOREROOM' });
    expect(onlyStoreroom.every((l) => l.type === 'STOREROOM')).toBe(true);
    const onlyInactive = await LocationService.list({ active: false });
    expect(onlyInactive.every((l) => !l.active)).toBe(true);
    const search = await LocationService.list({ q: 'Boiler' });
    expect(search.length).toBe(1);
    expect(search[0]?.name).toBe('Boiler Shop');
  });
});
