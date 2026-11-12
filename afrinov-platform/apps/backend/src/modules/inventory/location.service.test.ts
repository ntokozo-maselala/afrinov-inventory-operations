// Unit tests for LocationService. Uses an in-memory fake Prisma to verify
// list/create/update/status/delete semantics without a real database.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma, type LocationType } from '@prisma/client';

type Loc = {
  id: string;
  name: string;
  code: string | null;
  type: LocationType;
  active: boolean;
  parentId?: string | null;
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

type Grl = { id: string; locationId: string };
type InvTx = { id: string; locationId: string };
type InvBal = { materialId: string; locationId: string; quantity: number; sku?: string; heldForProject?: string };
/** A tool lent from a location, and how many have come back. */
type Loan = { id: string; materialId: string; sku: string; locationId: string; lent: number; back: number };

type AuditRow = { actorId: string; action: string; entityType: string; entityId: string };

const db = {
  locations: new Map<string, Loc>(),
  grls: new Map<string, Grl>(),
  invTxs: new Map<string, InvTx>(),
  invBal: new Map<string, InvBal>(),
  loans: [] as Loan[],
  /** Adjustments waiting for approval, by location. */
  waiting: new Map<string, number>(),
  /** inventory.projectReceivingLocationId. */
  receivingLocationId: '',
  audit: [] as AuditRow[],
  /** The advisory locks taken, one per locked change. */
  locks: [] as string[],
};
let counter = 0;
function nextId(): string { counter += 1; return `loc-${counter}`; }
function balKey(materialId: string, locationId: string): string { return `${materialId}|${locationId}`; }

vi.mock('../../shared/db.js', () => ({
  get prisma() { return makePrisma(); },
}));

function makePrisma(): unknown {
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
    $executeRaw: async (strings: TemplateStringsArray) => { db.locks.push(strings.join('?')); return 1; },
    location: {
      findUnique: async ({ where }: { where: { id?: string; name?: string; code?: string | null } }) => {
        if (where.id) return db.locations.get(where.id) ?? null;
        if (where.name) return [...db.locations.values()].find((l) => l.name === where.name) ?? null;
        if (where.code !== undefined) return [...db.locations.values()].find((l) => l.code === where.code) ?? null;
        return null;
      },
      findMany: async ({ where, include }: { where?: { type?: LocationType; active?: boolean; parentId?: string; OR?: unknown[] }; include?: { parent?: unknown } }) => {
        let list = [...db.locations.values()];
        if (where?.type) list = list.filter((l) => l.type === where.type);
        if (where?.parentId) list = list.filter((l) => l.parentId === where.parentId);
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
        return include?.parent ? list.map((l) => ({ ...l, parent: l.parentId ? db.locations.get(l.parentId) ?? null : null })) : list;
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
      count: async ({ where }: { where?: { parentId?: string; active?: boolean } } = {}) =>
        [...db.locations.values()].filter((l) =>
          (where?.parentId === undefined || l.parentId === where.parentId) &&
          (where?.active === undefined || l.active === where.active)).length,
    },
    goodsReceiptLine: {
      count: async ({ where }: { where: { locationId: string } }) =>
        [...db.grls.values()].filter((g) => g.locationId === where.locationId).length,
    },
    inventoryTransaction: {
      count: async ({ where }: { where: { locationId: string } }) =>
        [...db.invTxs.values()].filter((t) => t.locationId === where.locationId).length,
      // Loans from a location (toolsOutOn).
      findMany: async ({ where }: { where: { locationId?: string } }) => db.loans
        .filter((l) => l.locationId === where.locationId)
        .map((l) => ({ id: l.id, materialId: l.materialId, quantity: new Prisma.Decimal(-l.lent), material: { sku: l.sku } })),
      groupBy: async ({ where }: { where: { referenceId: { in: string[] } } }) => db.loans
        .filter((l) => where.referenceId.in.includes(l.id))
        .map((l) => ({ referenceId: l.id, _sum: { quantity: new Prisma.Decimal(l.back) } })),
    },
    adjustmentRequest: {
      count: async ({ where }: { where: { locationId: string } }) => db.waiting.get(where.locationId) ?? 0,
    },
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key === 'inventory.projectReceivingLocationId' ? { key: where.key, value: db.receivingLocationId } : null,
    },
    inventoryBalance: {
      findMany: async ({ where }: { where?: { locationId?: string | { in?: string[] }; quantity?: { not: number } } }) => {
        const at = where?.locationId;
        if (typeof at === 'string') {
          // What is on one location (the deactivation check): non-zero rows, with their item.
          return [...db.invBal.values()]
            .filter((b) => b.locationId === at && (where?.quantity === undefined || b.quantity !== 0))
            .map((b) => ({ quantity: new Prisma.Decimal(b.quantity), heldForProject: b.heldForProject ?? '', material: { sku: b.sku ?? b.materialId, unitOfMeasure: 'each' } }));
        }
        return at?.in ? [...db.invBal.values()].filter((b) => at.in!.includes(b.locationId)) : [...db.invBal.values()];
      },
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
  db.grls.clear();
  db.invTxs.clear();
  db.invBal.clear();
  db.loans.length = 0;
  db.waiting.clear();
  db.receivingLocationId = '';
  db.audit.length = 0;
  db.locks.length = 0;
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

  it('blocks deletion when dependencies exist (GR lines, transactions, balances)', async () => {
    const { LocationService } = await import('./location.service.js');
    const l = await LocationService.create({ name: 'A', type: 'STOREROOM' }, 'user-1');
    db.invTxs.set('t-1', { id: 't-1', locationId: l.id });
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

describe('LocationService: a location inside another', () => {
  const room = async (name = 'Main Storeroom') => (await import('./location.service.js')).LocationService.create({ name, type: 'STOREROOM' }, 'user-1');

  it('puts a rack inside a room, and lists it with its room', async () => {
    const { LocationService } = await import('./location.service.js');
    const store = await room();
    const rack = await LocationService.create({ name: 'D-1', type: 'RACK', parentId: store.id }, 'user-1');
    expect(rack.parentId).toBe(store.id);
    const listed = await LocationService.list({ parentId: store.id });
    expect(listed.map((l) => l.name)).toEqual(['D-1']);
    expect(listed[0]).toMatchObject({ parent: { name: 'Main Storeroom' } });
  });

  it('refuses a rack, an inactive location or one inside another as the room', async () => {
    const { LocationService } = await import('./location.service.js');
    const store = await room();
    const rack = await LocationService.create({ name: 'D-1', type: 'RACK', parentId: store.id }, 'user-1');
    await expect(LocationService.create({ name: 'D-1 top', type: 'RACK', parentId: rack.id }, 'user-1')).rejects.toThrow(/is a rack/);
    const cage = await LocationService.create({ name: 'Cage', type: 'STOREROOM', parentId: store.id }, 'user-1');
    await expect(LocationService.create({ name: 'Shelf', type: 'RACK', parentId: cage.id }, 'user-1')).rejects.toThrow(/one level deep/);
    const old = await LocationService.create({ name: 'Old shed', type: 'STOREROOM', active: false }, 'user-1');
    await expect(LocationService.create({ name: 'E-1', type: 'RACK', parentId: old.id }, 'user-1')).rejects.toThrow(/inactive/);
  });

  it('refuses a location inside itself, or a room with locations inside it going inside another', async () => {
    const { LocationService } = await import('./location.service.js');
    const store = await room();
    const upstairs = await room('Upstairs');
    await LocationService.create({ name: 'D-1', type: 'RACK', parentId: store.id }, 'user-1');
    await expect(LocationService.update({ id: store.id, parentId: store.id }, 'user-1')).rejects.toThrow(/inside itself/);
    await expect(LocationService.update({ id: store.id, parentId: upstairs.id }, 'user-1')).rejects.toThrow(/has locations inside it/);
  });

  it('moves a rack to another room, or out of any room with null', async () => {
    const { LocationService } = await import('./location.service.js');
    const store = await room();
    const upstairs = await room('Upstairs');
    const rack = await LocationService.create({ name: 'D-1', type: 'RACK', parentId: store.id }, 'user-1');
    expect((await LocationService.update({ id: rack.id, parentId: upstairs.id }, 'user-1')).parentId).toBe(upstairs.id);
    expect((await LocationService.update({ id: rack.id, parentId: null }, 'user-1')).parentId).toBeNull();
  });

  it('will not deactivate, delete or turn into a rack a room with locations inside it', async () => {
    const { LocationService } = await import('./location.service.js');
    const store = await room();
    await LocationService.create({ name: 'D-1', type: 'RACK', parentId: store.id }, 'user-1');
    await expect(LocationService.setStatus(store.id, false, 'user-1')).rejects.toThrow(/1 active location inside it/);
    await expect(LocationService.update({ id: store.id, active: false }, 'user-1')).rejects.toThrow(/active location inside it/);
    await expect(LocationService.update({ id: store.id, type: 'RACK' }, 'user-1')).rejects.toThrow(/cannot be a rack/);
    await expect(LocationService.remove(store.id, 'user-1')).rejects.toMatchObject({ details: { dependencies: { locations: 1 } } });
  });
  it('will not reactivate a rack while its room is inactive', async () => {
    const { LocationService } = await import('./location.service.js');
    const store = await room();
    const rack = await LocationService.create({ name: 'D-1', type: 'RACK', parentId: store.id }, 'user-1');
    await LocationService.setStatus(rack.id, false, 'user-1');
    await LocationService.setStatus(store.id, false, 'user-1');
    await expect(LocationService.setStatus(rack.id, true, 'user-1')).rejects.toThrow(/inside Main Storeroom, which is inactive/);
    await expect(LocationService.update({ id: rack.id, active: true }, 'user-1')).rejects.toThrow(/which is inactive/);
    // Moved out of the room, it can be reactivated.
    expect((await LocationService.update({ id: rack.id, parentId: null, active: true }, 'user-1')).active).toBe(true);
  });

  it('says to move the locations out, not to deactivate, when a room cannot be deleted', async () => {
    const { LocationService } = await import('./location.service.js');
    const store = await room();
    await LocationService.create({ name: 'D-1', type: 'RACK', parentId: store.id }, 'user-1');
    await expect(LocationService.remove(store.id, 'user-1')).rejects.toThrow('Main Storeroom has 1 location inside it. Move them out of it before deleting it.');
  });

  it('takes the location-tree lock for every change, so two edits at once see the same locations', async () => {
    const { LocationService } = await import('./location.service.js');
    const store = await room();
    const rack = await LocationService.create({ name: 'D-1', type: 'RACK', parentId: store.id }, 'user-1');
    await LocationService.update({ id: rack.id, name: 'D-2' }, 'user-1');
    await LocationService.setStatus(rack.id, false, 'user-1');
    const treeLocks = db.locks.filter((q) => q.includes('pg_advisory_xact_lock'));
    expect(treeLocks).toHaveLength(4);
    expect(treeLocks.every((q) => q.includes('afrinov:location-tree'))).toBe(true);
    // Deactivating also holds the location's row, so no movement onto it can slip past the check (system audit A1).
    expect(db.locks.some((q) => q.includes('FROM locations') && q.includes('FOR UPDATE'))).toBe(true);
  });
});

// System audit A1: a location is closed only when nothing is left on it.
describe('LocationService: deactivating only when clear', () => {
  async function rack(name = 'R-1') {
    const { LocationService } = await import('./location.service.js');
    return LocationService.create({ name, type: 'RACK' }, 'user-1');
  }

  it('refuses while stock is on it, Stores or a project\'s, and lists it', async () => {
    const { LocationService } = await import('./location.service.js');
    const r = await rack();
    db.invBal.set('m1|' + r.id, { materialId: 'm1', sku: 'BOLT-M12', locationId: r.id, quantity: 40 });
    db.invBal.set('m2|' + r.id, { materialId: 'm2', sku: 'PIPE-50', locationId: r.id, quantity: 3, heldForProject: 'P-100' });
    db.invBal.set('m3|' + r.id, { materialId: 'm3', sku: 'EMPTY', locationId: r.id, quantity: 0 });
    await expect(LocationService.setStatus(r.id, false, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT', message: expect.stringMatching(/40 each of BOLT-M12; 3 each of PIPE-50, held for project P-100/),
    });
    expect(db.locations.get(r.id)?.active).toBe(true);
    const check = await LocationService.deactivationCheck(r.id);
    expect(check.blockers.map((b) => b.kind)).toEqual(['STOCK', 'STOCK']);
  });

  it('refuses while a tool lent from it is still out, or an adjustment waits there', async () => {
    const { LocationService } = await import('./location.service.js');
    const r = await rack();
    db.loans.push({ id: 'loan-1', materialId: 't1', sku: 'DRILL-01', locationId: r.id, lent: 2, back: 1 });
    db.waiting.set(r.id, 1);
    const { blockers } = await LocationService.deactivationCheck(r.id);
    expect(blockers).toEqual([
      { kind: 'LOAN', text: '1 × DRILL-01 out on loan from here' },
      { kind: 'APPROVAL', text: '1 adjustment here waiting for approval' },
    ]);
    // The same rule through PATCH /locations/:id.
    await expect(LocationService.update({ id: r.id, active: false }, 'user-1')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses while project deliveries are booked there', async () => {
    const { LocationService } = await import('./location.service.js');
    const r = await rack();
    db.receivingLocationId = r.id;
    expect((await LocationService.deactivationCheck(r.id)).blockers).toEqual([{ kind: 'SETTING', text: 'Project deliveries are booked here (Settings → Inventory)' }]);
  });

  it('deactivates once clear: empty rows and tools all back don\'t count', async () => {
    const { LocationService } = await import('./location.service.js');
    const r = await rack();
    db.invBal.set('m1|' + r.id, { materialId: 'm1', locationId: r.id, quantity: 0 });
    db.loans.push({ id: 'loan-2', materialId: 't1', sku: 'DRILL-01', locationId: r.id, lent: 1, back: 1 });
    expect((await LocationService.deactivationCheck(r.id)).blockers).toEqual([]);
    await LocationService.setStatus(r.id, false, 'user-1');
    expect(db.locations.get(r.id)?.active).toBe(false);
  });
});

