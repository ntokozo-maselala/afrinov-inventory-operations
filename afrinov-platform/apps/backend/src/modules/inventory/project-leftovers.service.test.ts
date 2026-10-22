// A closed project's leftovers move to Stores (materials sections roadmap,
// Phase 7): each item becomes a Stores item in its chosen category, keeping
// its stock and history; an open project's material stays with it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Mat = { id: string; sku: string; name: string; unitOfMeasure: string; category: string; projectNumber: string | null; requiredStock: number; unitCost: Prisma.Decimal | null };
const db = {
  projects: new Map<string, { projectNumber: string; name: string | null; status: string }>(),
  materials: new Map<string, Mat>(),
  balances: [] as Array<{ materialId: string; location: { name: string }; quantity: Prisma.Decimal }>,
  audit: [] as Array<Record<string, unknown>>,
};

const client = {
  project: { findUnique: async ({ where }: { where: { projectNumber: string } }) => db.projects.get(where.projectNumber) ?? null },
  material: {
    // A copy, as Prisma returns.
    findUnique: async ({ where }: { where: { id: string } }) => { const m = db.materials.get(where.id); return m ? { ...m } : null; },
    findMany: async ({ where }: { where: { category: string; projectNumber: string } }) => [...db.materials.values()]
      .filter((m) => m.category === where.category && m.projectNumber === where.projectNumber)
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((m) => ({ ...m, inventoryBalances: db.balances.filter((b) => b.materialId === m.id && b.quantity.gt(0)) })),
    updateMany: async ({ where, data }: { where: { id: string; category: string; projectNumber: string }; data: Partial<Mat> }) => {
      const m = db.materials.get(where.id);
      if (!m || m.category !== where.category || m.projectNumber !== where.projectNumber) return { count: 0 };
      Object.assign(m, data);
      return { count: 1 };
    },
  },
  auditLogEntry: { create: async ({ data }: { data: Record<string, unknown> }) => { db.audit.push(data); return data; } },
};
vi.mock('../../shared/db.js', () => ({ prisma: { ...client, $transaction: (fn: (tx: unknown) => unknown) => fn(client) } }));

const { ProjectLeftoversService } = await import('./project-leftovers.service.js');

const pipe = (id: string, projectNumber: string, unitCost: number | null = 100): Mat => ({
  id, sku: `${projectNumber}-${id.toUpperCase()}`, name: `Pipe ${id}`, unitOfMeasure: 'm', category: 'PROJECT_MATERIAL',
  projectNumber, requiredStock: 0, unitCost: unitCost === null ? null : new Prisma.Decimal(unitCost),
});

beforeEach(() => {
  db.projects.clear();
  db.materials.clear();
  db.balances = [];
  db.audit = [];
  db.projects.set('1369', { projectNumber: '1369', name: 'Plant upgrade', status: 'COMPLETED' });
  db.projects.set('1402', { projectNumber: '1402', name: 'Boiler', status: 'ACTIVE' });
  for (const m of [pipe('p1', '1369'), pipe('p2', '1369', null), pipe('p3', '1369'), pipe('p4', '1402')]) db.materials.set(m.id, m);
  db.balances.push(
    { materialId: 'p1', location: { name: 'A-1' }, quantity: new Prisma.Decimal(4) },
    { materialId: 'p1', location: { name: 'B-2' }, quantity: new Prisma.Decimal(2) },
    { materialId: 'p2', location: { name: 'A-1' }, quantity: new Prisma.Decimal(1.5) },
    { materialId: 'p3', location: { name: 'A-1' }, quantity: new Prisma.Decimal(0) },
  );
});

describe('listing a project\'s leftovers', () => {
  it('lists its material still in stock, with where it is and its value', async () => {
    const { project, items } = await ProjectLeftoversService.list('1369');
    expect(project).toEqual({ projectNumber: '1369', name: 'Plant upgrade', status: 'COMPLETED', closed: true });
    expect(items).toEqual([
      { materialId: 'p1', sku: '1369-P1', name: 'Pipe p1', unitOfMeasure: 'm', onHand: '6', value: 600, locations: 'A-1 (4), B-2 (2)' },
      { materialId: 'p2', sku: '1369-P2', name: 'Pipe p2', unitOfMeasure: 'm', onHand: '1.5', value: null, locations: 'A-1 (1.5)' },
    ]);
  });

  it('says whether the project is closed, and refuses an unknown one', async () => {
    expect((await ProjectLeftoversService.list('1402')).project.closed).toBe(false);
    await expect(ProjectLeftoversService.list('NOPE')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('moving leftovers to Stores', () => {
  it('makes each item a Stores item in its chosen category, with no project, and logs it', async () => {
    expect(await ProjectLeftoversService.moveToStores('1369', [
      { materialId: 'p1', category: 'CONSUMABLES' }, { materialId: 'p2', category: 'FASTENERS_SLUGS_INSULATION' },
    ], 'user-1')).toEqual({ moved: 2 });
    expect(db.materials.get('p1')).toMatchObject({ sku: '1369-P1', category: 'CONSUMABLES', projectNumber: null, requiredStock: 0 });
    expect(db.materials.get('p2')).toMatchObject({ category: 'FASTENERS_SLUGS_INSULATION', projectNumber: null });
    expect(db.materials.get('p3')).toMatchObject({ category: 'PROJECT_MATERIAL', projectNumber: '1369' });
    expect(db.audit[0]).toMatchObject({
      action: 'MOVE_TO_STORES', entityType: 'Material', entityId: 'p1', actorId: 'user-1',
      before: { category: 'PROJECT_MATERIAL', projectNumber: '1369' }, after: { category: 'CONSUMABLES', projectNumber: null },
    });
  });

  it('refuses while the project is open', async () => {
    await expect(ProjectLeftoversService.moveToStores('1402', [{ materialId: 'p4', category: 'CONSUMABLES' }], 'user-1'))
      .rejects.toMatchObject({ message: expect.stringMatching(/Project 1402 is still open, so its material stays with it/) });
    expect(db.materials.get('p4')!.category).toBe('PROJECT_MATERIAL');
  });

  it('refuses another project\'s material, an empty list and an item listed twice', async () => {
    await expect(ProjectLeftoversService.moveToStores('1369', [{ materialId: 'p4', category: 'CONSUMABLES' }], 'user-1'))
      .rejects.toMatchObject({ message: '1402-P4 is not material of project 1369, so it isn\'t moved from it.' });
    await expect(ProjectLeftoversService.moveToStores('1369', [], 'user-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ProjectLeftoversService.moveToStores('1369', [{ materialId: 'p1', category: 'CONSUMABLES' }, { materialId: 'p1', category: 'CONSUMABLES' }], 'user-1'))
      .rejects.toMatchObject({ message: 'An item is listed twice' });
  });

  it('says so when someone else has just moved it', async () => {
    const real = client.material.findUnique;
    // Read as the project's, then moved by someone else before this move lands.
    client.material.findUnique = async ({ where }) => {
      const m = await real({ where });
      db.materials.get(where.id)!.projectNumber = null;
      return m && { ...m, projectNumber: '1369' };
    };
    try {
      await expect(ProjectLeftoversService.moveToStores('1369', [{ materialId: 'p1', category: 'CONSUMABLES' }], 'user-1'))
        .rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      client.material.findUnique = real;
    }
  });
});
