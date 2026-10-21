// Stores and Projects materials (materials sections roadmap, Phase 1): a
// Projects material belongs to one open project and has no Required Stock; a
// Stores material has no project; an item's project is fixed once it has
// stock movements, though an unassigned item can always be given its first.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Material = { id: string; sku: string; name: string; category: string; projectNumber: string | null; requiredStock: number; [k: string]: unknown };
type Where = { id?: string; sku?: string };

const db = {
  materials: new Map<string, Material>(),
  projects: new Map<string, { active: boolean; status: string }>(),
  movements: new Map<string, number>(),
};
let seq = 0;

function makePrisma(): unknown {
  return {
    material: {
      findUnique: async ({ where }: { where: Where }) =>
        [...db.materials.values()].find((m) => (where.id ? m.id === where.id : m.sku === where.sku)) ?? null,
      findFirst: async () => null,
      findMany: async ({ where }: { where: { category?: string | { not: string }; projectNumber?: string } }) =>
        [...db.materials.values()].filter((m) => {
          const c = where.category;
          if (typeof c === 'string' && m.category !== c) return false;
          if (c && typeof c === 'object' && m.category === c.not) return false;
          return !where.projectNumber || m.projectNumber === where.projectNumber;
        }),
      create: async ({ data }: { data: Omit<Material, 'id'> }) => {
        const m = { projectNumber: null, ...data, id: `mat-${++seq}` } as Material;
        db.materials.set(m.id, m);
        return m;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Material> }) => {
        const m = { ...db.materials.get(where.id)!, ...data };
        db.materials.set(m.id, m);
        return m;
      },
    },
    project: {
      findUnique: async ({ where }: { where: { projectNumber: string } }) => db.projects.get(where.projectNumber) ?? null,
    },
    inventoryTransaction: {
      count: async ({ where }: { where: { materialId: string } }) => db.movements.get(where.materialId) ?? 0,
    },
    auditLogEntry: { create: async ({ data }: { data: unknown }) => data },
  };
}

vi.mock('../../shared/db.js', () => ({ get prisma() { return makePrisma(); } }));

const { MaterialService } = await import('./material.service.js');
const { refuseUnassigned } = await import('./material-section.js');

const projectItem = (sku: string, projectNumber?: string, extra: Record<string, unknown> = {}) =>
  MaterialService.create({ sku, name: `Pipe ${sku}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'each', projectNumber, ...extra }, 'admin');
const storesItem = (sku: string, extra: Record<string, unknown> = {}) =>
  MaterialService.create({ sku, name: `Disc ${sku}`, category: 'CONSUMABLES', unitOfMeasure: 'each', ...extra }, 'admin');

beforeEach(() => {
  db.materials.clear();
  db.movements.clear();
  db.projects.clear();
  db.projects.set('1369', { active: true, status: 'ACTIVE' });
  db.projects.set('1402', { active: true, status: 'PLANNING' });
  db.projects.set('1200', { active: true, status: 'COMPLETED' });
  db.projects.set('1100', { active: false, status: 'CANCELLED' });
  seq = 0;
});

describe('creating Stores and Projects material', () => {
  it('keeps a Projects material with its project, in the Projects section', async () => {
    const m = await projectItem('1369-PIPE-150NB', '1369');
    expect(m).toMatchObject({ projectNumber: '1369', section: 'PROJECTS', requiredStock: 0 });
  });

  it('puts every other category in Stores, with no project', async () => {
    expect(await storesItem('CON-1', { requiredStock: 20 })).toMatchObject({ section: 'STORES', projectNumber: null, requiredStock: 20 });
  });

  it('refuses a Projects material without a project', async () => {
    await expect(projectItem('1369-PIPE')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/needs the project/) });
  });

  it('refuses Required Stock on a Projects material', async () => {
    await expect(projectItem('1369-PIPE', '1369', { requiredStock: 5 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/no Required Stock/) });
  });

  it('refuses a project on a Stores material', async () => {
    await expect(storesItem('CON-1', { projectNumber: '1369' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/Stores material has no project/) });
  });

  it('refuses an unknown project, and a completed or cancelled one', async () => {
    await expect(projectItem('X-1', '9999')).rejects.toMatchObject({ message: expect.stringMatching(/does not exist/) });
    await expect(projectItem('X-2', '1200')).rejects.toMatchObject({ message: expect.stringMatching(/is closed/) });
    await expect(projectItem('X-3', '1100')).rejects.toMatchObject({ message: expect.stringMatching(/is closed/) });
  });
});

describe('changing a material', () => {
  /** An item moved in from the old Project Material category: no project yet. */
  function unassigned(id: string) {
    db.materials.set(id, { id, sku: id, name: id, category: 'PROJECT_MATERIAL', projectNumber: null, requiredStock: 0 });
  }

  it('assigns a first project to an unassigned item, even with stock', async () => {
    unassigned('old-1');
    db.movements.set('old-1', 3);
    expect(await MaterialService.update({ id: 'old-1', projectNumber: '1369' }, 'admin')).toMatchObject({ projectNumber: '1369', section: 'PROJECTS' });
  });

  it('moves an item to another project only while it has no movements', async () => {
    const m = await projectItem('PIPE', '1369');
    expect(await MaterialService.update({ id: m.id, projectNumber: '1402' }, 'admin')).toMatchObject({ projectNumber: '1402' });
    db.movements.set(m.id, 1);
    await expect(MaterialService.update({ id: m.id, projectNumber: '1369' }, 'admin'))
      .rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/stays with that project/) });
  });

  it('leaves the project alone when it is sent unchanged, or not at all', async () => {
    const m = await projectItem('PIPE', '1369');
    db.movements.set(m.id, 4);
    expect(await MaterialService.update({ id: m.id, projectNumber: '1369', name: 'Pipe 150NB' }, 'admin')).toMatchObject({ projectNumber: '1369', name: 'Pipe 150NB' });
  });

  it('refuses Required Stock on a Projects material, and a project on a Stores one', async () => {
    const p = await projectItem('PIPE', '1369');
    await expect(MaterialService.update({ id: p.id, requiredStock: 10 }, 'admin')).rejects.toMatchObject({ message: expect.stringMatching(/no Required Stock/) });
    expect(await MaterialService.update({ id: p.id, requiredStock: 0 }, 'admin')).toMatchObject({ requiredStock: 0 });
    const s = await storesItem('CON-1');
    await expect(MaterialService.update({ id: s.id, projectNumber: '1369' }, 'admin')).rejects.toMatchObject({ message: expect.stringMatching(/Stores material has no project/) });
  });

  it('refuses a closed project when assigning', async () => {
    unassigned('old-2');
    await expect(MaterialService.update({ id: 'old-2', projectNumber: '1200' }, 'admin')).rejects.toMatchObject({ message: expect.stringMatching(/is closed/) });
  });
});

describe('material with no project yet', () => {
  it('is refused for issuing and ordering; with a project, or in Stores, it is not', () => {
    expect(() => refuseUnassigned({ sku: 'OLD-PLATE', category: 'PROJECT_MATERIAL', projectNumber: null }, 'ordered'))
      .toThrow("OLD-PLATE has no project yet, so it can't be ordered. Give it its project on Materials first.");
    expect(() => refuseUnassigned({ sku: 'PIPE', category: 'PROJECT_MATERIAL', projectNumber: '1369' }, 'issued')).not.toThrow();
    expect(() => refuseUnassigned({ sku: 'DISC', category: 'CONSUMABLES', projectNumber: null }, 'issued')).not.toThrow();
  });
});

describe('listing by section', () => {
  it('lists Stores, Projects, and one project’s material', async () => {
    await storesItem('CON-1');
    await projectItem('A', '1369');
    await projectItem('B', '1402');
    expect((await MaterialService.list({ section: 'STORES' })).map((m) => m.sku)).toEqual(['CON-1']);
    expect((await MaterialService.list({ section: 'PROJECTS' })).map((m) => m.sku).sort()).toEqual(['A', 'B']);
    expect((await MaterialService.list({ section: 'PROJECTS', projectNumber: '1402' })).map((m) => m.sku)).toEqual(['B']);
  });
});
