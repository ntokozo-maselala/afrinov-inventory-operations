// Unit tests for MaterialService: the serial number a tool kept as one unit
// carries, and which items track use after issue.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Material = { id: string; sku: string; name: string; category: string; serialNumber: string | null; [k: string]: unknown };
type SerialFilter = { equals: string; mode?: string };

const db = { materials: new Map<string, Material>(), audit: [] as Array<{ action: string; entityId: string }> };
let seq = 0;
// Some of the listed units (units_of_measure), and one taken off the list.
const UNITS: Record<string, { code: string; kind: 'COUNTED' | 'MEASURED'; active: boolean }> = {
  each: { code: 'each', kind: 'COUNTED', active: true },
  pair: { code: 'pair', kind: 'COUNTED', active: true },
  m: { code: 'm', kind: 'MEASURED', active: true },
  gross: { code: 'gross', kind: 'COUNTED', active: false },
};

function makePrisma(): unknown {
  return {
    material: {
      findUnique: async ({ where }: { where: { id?: string; sku?: string } }) =>
        [...db.materials.values()].find((m) => (where.id ? m.id === where.id : m.sku === where.sku)) ?? null,
      findFirst: async ({ where }: { where: { serialNumber: SerialFilter; id?: { not: string } } }) =>
        [...db.materials.values()].find((m) => m.serialNumber?.toLowerCase() === where.serialNumber.equals.toLowerCase() && m.id !== where.id?.not) ?? null,
      create: async ({ data }: { data: Omit<Material, 'id'> }) => {
        const m = { ...data, id: `mat-${++seq}` } as Material;
        db.materials.set(m.id, m);
        return m;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Material> }) => {
        const m = { ...db.materials.get(where.id)!, ...data };
        db.materials.set(m.id, m);
        return m;
      },
    },
    unitOfMeasure: {
      findUnique: async ({ where }: { where: { code: string } }) => UNITS[where.code] ?? null,
      findUniqueOrThrow: async ({ where }: { where: { code: string } }) => UNITS[where.code]!,
    },
    auditLogEntry: { create: async ({ data }: { data: { action: string; entityId: string } }) => { db.audit.push(data); return data; } },
    // The service wraps each mutation and its audit write in one transaction;
    // the mock runs the callback against the same in-memory client.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrisma()),
  };
}

vi.mock('../../shared/db.js', () => ({ get prisma() { return makePrisma(); } }));

const { MaterialService } = await import('./material.service.js');

const tool = (sku: string, serialNumber?: string) => MaterialService.create({ sku, name: `Drill ${sku}`, category: 'TOOLS', unitOfMeasure: 'each', serialNumber }, 'admin');

beforeEach(() => {
  db.materials.clear();
  db.audit.length = 0;
  seq = 0;
});

describe('MaterialService serial numbers', () => {
  it('keeps the serial number of a tool, tidied', async () => {
    const m = await tool('TL-0001', '  34322 ');
    expect(m.serialNumber).toBe('34322');
    expect((await tool('TL-0002')).serialNumber).toBeNull();
  });

  it('refuses a serial number on anything but a tool', async () => {
    await expect(MaterialService.create({ sku: 'CON-1', name: 'Disc', category: 'CONSUMABLES', unitOfMeasure: 'each', serialNumber: '123' }, 'admin'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a serial number another item already has, in any case', async () => {
    await tool('TL-0001', 'AB123');
    await expect(tool('TL-0002', 'ab123')).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('TL-0001') });
  });

  it('sets, keeps and clears a serial number on update', async () => {
    const m = await tool('TL-0001');
    expect((await MaterialService.update({ id: m.id, serialNumber: '777' }, 'admin')).serialNumber).toBe('777');
    expect((await MaterialService.update({ id: m.id, serialNumber: '777' }, 'admin')).serialNumber).toBe('777');
    expect((await MaterialService.update({ id: m.id, name: 'Renamed' }, 'admin')).serialNumber).toBe('777');
    expect((await MaterialService.update({ id: m.id, serialNumber: null }, 'admin')).serialNumber).toBeNull();
  });
});

describe('MaterialService track use', () => {
  it('is off unless asked for, and can be switched on and off later', async () => {
    const m = await MaterialService.create({ sku: 'CON-1', name: 'Cutting disc', category: 'CONSUMABLES', unitOfMeasure: 'each' }, 'admin');
    expect(m.trackUse).toBe(false);
    expect((await MaterialService.update({ id: m.id, trackUse: true }, 'admin')).trackUse).toBe(true);
    expect((await MaterialService.update({ id: m.id, name: 'Cutting disc 230mm' }, 'admin')).trackUse).toBe(true);
    expect((await MaterialService.update({ id: m.id, trackUse: false }, 'admin')).trackUse).toBe(false);
    const tracked = await MaterialService.create({ sku: 'CON-2', name: 'Hole saw', category: 'TOOLING_PPE_ELECTRICAL', unitOfMeasure: 'each', trackUse: true }, 'admin');
    expect(tracked.trackUse).toBe(true);
  });

  it('refuses it on a tool, which is lent and checked back in', async () => {
    await expect(MaterialService.create({ sku: 'TL-1', name: 'Drill', category: 'TOOLS', unitOfMeasure: 'each', trackUse: true }, 'admin'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('Tools are lent') });
    const t = await tool('TL-2');
    await expect(MaterialService.update({ id: t.id, trackUse: true }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await MaterialService.update({ id: t.id, trackUse: false }, 'admin')).trackUse).toBe(false);
  });
});

describe('MaterialService update', () => {
  it('sets and clears the unit cost and description, and audits each change', async () => {
    const m = await MaterialService.create({ sku: 'CON-1', name: 'Disc', category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 12.5, description: 'Thin' }, 'admin');
    const priced = await MaterialService.update({ id: m.id, unitCost: 14, requiredStock: 40 }, 'admin');
    expect(priced).toMatchObject({ unitCost: 14, requiredStock: 40, description: 'Thin' });
    const cleared = await MaterialService.update({ id: m.id, unitCost: null, description: null }, 'admin');
    expect(cleared.unitCost).toBeNull();
    expect(cleared.description).toBeNull();
    expect(db.audit.filter((a) => a.entityId === m.id).map((a) => a.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
  });

  it('deactivates and reactivates an item', async () => {
    const m = await MaterialService.create({ sku: 'CON-2', name: 'Glove', category: 'CONSUMABLES', unitOfMeasure: 'pair' }, 'admin');
    expect((await MaterialService.update({ id: m.id, active: false }, 'admin')).active).toBe(false);
    expect((await MaterialService.update({ id: m.id, active: true }, 'admin')).active).toBe(true);
  });
});

describe('MaterialService units of measure', () => {
  it('saves any spelling of a listed unit under its code', async () => {
    const m = await MaterialService.create({ sku: 'WSH-1', name: 'M16 flat washer', category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: ' EA ' }, 'admin');
    expect(m.unitOfMeasure).toBe('each');
    expect((await MaterialService.update({ id: m.id, unitOfMeasure: 'Metres' }, 'admin')).unitOfMeasure).toBe('m');
  });

  it('refuses a unit that is not on the list, or no longer in use', async () => {
    await expect(MaterialService.create({ sku: 'WSH-2', name: 'Washer', category: 'CONSUMABLES', unitOfMeasure: 'bundle' }, 'admin'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: '"bundle" is not a unit on the list. Choose one, such as each, pair, box, m or kg.' });
    await expect(MaterialService.create({ sku: 'WSH-3', name: 'Washer', category: 'CONSUMABLES', unitOfMeasure: 'gross' }, 'admin'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.materials.size).toBe(0);
  });

  it('keeps Required Stock of a counted item whole', async () => {
    await expect(MaterialService.create({ sku: 'GLV-1', name: 'Welding gloves', category: 'CONSUMABLES', unitOfMeasure: 'pair', requiredStock: 2.5 }, 'admin'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Welding gloves is counted in whole numbers (pair). Enter 1, 2, 3 …' });
    const m = await MaterialService.create({ sku: 'GLV-1', name: 'Welding gloves', category: 'CONSUMABLES', unitOfMeasure: 'pair', requiredStock: 4 }, 'admin');
    await expect(MaterialService.update({ id: m.id, requiredStock: 4.5 }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await MaterialService.update({ id: m.id, unitOfMeasure: 'm', requiredStock: 4.5 }, 'admin')).requiredStock).toBe(4.5);
  });

  it('keeps a unit carried over from before the list when the item is edited without changing it', async () => {
    db.materials.set('old-1', { id: 'old-1', sku: 'OLD-1', name: 'Old item', category: 'CONSUMABLES', serialNumber: null, unitOfMeasure: 'gross' });
    const m = await MaterialService.update({ id: 'old-1', name: 'Renamed', unitOfMeasure: 'gross' }, 'admin');
    expect(m).toMatchObject({ name: 'Renamed', unitOfMeasure: 'gross' });
  });
});
