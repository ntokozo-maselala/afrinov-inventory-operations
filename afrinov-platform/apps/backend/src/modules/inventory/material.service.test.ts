// Unit tests for MaterialService: the serial number a tool kept as one unit
// carries, and which items track use after issue.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Material = { id: string; sku: string; name: string; category: string; serialNumber: string | null; [k: string]: unknown };
type SerialFilter = { equals: string; mode?: string };
type StatusChange = { active: boolean; reasonCode: string; note: string | null; actorId: string };

const db = { materials: new Map<string, Material>(), audit: [] as Array<{ action: string; entityId: string }>, statusChanges: [] as StatusChange[], onLoan: [] as Array<{ materialId: string; quantity: number }>, waiting: [] as string[], orderLines: [] as Array<{ materialId: string; ordered: number; received: number }>, balances: [] as Array<{ materialId: string; quantity: number; location: string }> };
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
        m['active'] ??= true;
        db.materials.set(m.id, m);
        return m;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Material> }) => {
        const m = { ...db.materials.get(where.id)!, ...data };
        db.materials.set(m.id, m);
        return m;
      },
    },
    inventoryBalance: {
      findMany: async ({ where }: { where: { materialId: string } }) => db.balances
        .filter((b) => b.materialId === where.materialId && b.quantity !== 0)
        .map((b) => ({ quantity: new Prisma.Decimal(b.quantity), heldForProject: '', location: { name: b.location } })),
    },
    $executeRaw: async () => 1,
    materialStatusChange: {
      create: async ({ data }: { data: StatusChange }) => { db.statusChanges.push(data); return data; },
    },
    inventoryTransaction: {
      groupBy: async () => db.onLoan.map(({ materialId, quantity }) => ({ materialId, _sum: { quantity: new Prisma.Decimal(-quantity) } })),
    },
    adjustmentRequest: {
      count: async ({ where }: { where: { materialId: string } }) => db.waiting.filter((id) => id === where.materialId).length,
    },
    purchaseOrderLine: {
      findMany: async ({ where }: { where: { materialId: string } }) => db.orderLines
        .filter((l) => l.materialId === where.materialId)
        .map((l) => ({ orderedQty: new Prisma.Decimal(l.ordered), receivedQty: new Prisma.Decimal(l.received), purchaseOrder: { id: 'po-1', number: 'PO-7', projectNumber: null } })),
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
  db.statusChanges.length = 0;
  db.balances.length = 0;
  db.onLoan.length = 0;
  db.waiting.length = 0;
  db.orderLines.length = 0;
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
    expect((await MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'OBSOLETE' }, 'admin')).active).toBe(false);
    expect((await MaterialService.setStatus({ id: m.id, active: true, reasonCode: 'BACK_IN_USE' }, 'admin')).active).toBe(true);
    expect(db.statusChanges.map((c) => [c.active, c.reasonCode, c.actorId])).toEqual([[false, 'OBSOLETE', 'admin'], [true, 'BACK_IN_USE', 'admin']]);
    expect(db.audit.filter((a) => a.entityId === m.id).map((a) => a.action)).toEqual(['CREATE', 'DEACTIVATE', 'ACTIVATE']);
  });

  it('adds nothing when the item already has that status, so a retry is safe', async () => {
    const m = await MaterialService.create({ sku: 'CON-3', name: 'Mask', category: 'CONSUMABLES', unitOfMeasure: 'each' }, 'admin');
    await MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'OBSOLETE' }, 'admin');
    await MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'OBSOLETE' }, 'admin');
    expect(db.statusChanges).toHaveLength(1);
  });

  it('keeps a note, trimmed, and asks for one when the reason is Other', async () => {
    const m = await MaterialService.create({ sku: 'CON-4', name: 'Tape', category: 'CONSUMABLES', unitOfMeasure: 'each' }, 'admin');
    await expect(MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'OTHER', note: '   ' }, 'admin')).rejects.toThrow(/note saying why/);
    await MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'OTHER', note: ' Stolen range ' }, 'admin');
    expect(db.statusChanges.at(-1)).toMatchObject({ reasonCode: 'OTHER', note: 'Stolen range' });
  });

  it('refuses a reason that belongs to the other change', async () => {
    const m = await MaterialService.create({ sku: 'CON-5', name: 'Rag', category: 'CONSUMABLES', unitOfMeasure: 'each' }, 'admin');
    await expect(MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'BACK_IN_USE' }, 'admin')).rejects.toThrow(/not one for deactivating/);
    expect(db.statusChanges).toHaveLength(0);
  });

  it('lists all that stands in the way, and refuses to deactivate until it is cleared', async () => {
    const m = await MaterialService.create({ sku: 'CON-6', name: 'Rope', category: 'CONSUMABLES', unitOfMeasure: 'each' }, 'admin');
    db.balances.push({ materialId: m.id, quantity: 7, location: 'Rack A' });
    db.onLoan.push({ materialId: m.id, quantity: 2 });
    db.waiting.push(m.id);
    db.orderLines.push({ materialId: m.id, ordered: 20, received: 5 });
    const { blockers } = await MaterialService.deactivationCheck(m.id);
    expect(blockers.map((b) => [b.kind, b.text])).toEqual([
      ['STOCK', '7 each on hand at Rack A'],
      ['LOAN', '2 each out on loan'],
      ['APPROVAL', '1 adjustment waiting for approval'],
      ['ORDER', 'Order PO-7: 15 each still owed'],
    ]);
    await expect(MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'OBSOLETE' }, 'admin')).rejects.toThrow(/CON-6 is not clear yet/);
    expect(db.statusChanges).toHaveLength(0);
    expect((await MaterialService.getById(m.id)).active).toBe(true);
  });

  it('counts an order line received in full as clear', async () => {
    const m = await MaterialService.create({ sku: 'CON-7', name: 'Wire', category: 'CONSUMABLES', unitOfMeasure: 'each' }, 'admin');
    db.orderLines.push({ materialId: m.id, ordered: 5, received: 5 });
    expect((await MaterialService.deactivationCheck(m.id)).blockers).toEqual([]);
    expect((await MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'OBSOLETE' }, 'admin')).active).toBe(false);
  });

  it('reactivates whatever the item holds, so stock that turned up can be booked', async () => {
    const m = await MaterialService.create({ sku: 'CON-8', name: 'Cord', category: 'CONSUMABLES', unitOfMeasure: 'each' }, 'admin');
    await MaterialService.setStatus({ id: m.id, active: false, reasonCode: 'OBSOLETE' }, 'admin');
    db.balances.push({ materialId: m.id, quantity: 3, location: 'Rack A' });
    expect((await MaterialService.setStatus({ id: m.id, active: true, reasonCode: 'STOCK_CAME_BACK' }, 'admin')).active).toBe(true);
  });

  it('refuses an item it cannot find', async () => {
    await expect(MaterialService.setStatus({ id: 'nope', active: false, reasonCode: 'OBSOLETE' }, 'admin')).rejects.toThrow(/not found/i);
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

// Qodo, PR #153: moved to a counted unit, part-units on hand could never be moved again.
describe('MaterialService moving an item to a counted unit', () => {
  it('refuses while it holds part of a unit, or keeps a part-unit Required Stock', async () => {
    const m = await MaterialService.create({ sku: 'CBL-1', name: 'Welding cable', category: 'CONSUMABLES', unitOfMeasure: 'm', requiredStock: 2.5 }, 'admin');
    db.balances.push({ materialId: m.id, quantity: 7.5, location: 'Rack A' });
    await expect(MaterialService.update({ id: m.id, unitOfMeasure: 'each' }, 'admin')).rejects.toMatchObject({ message: 'Welding cable is counted in whole numbers (each). Enter 1, 2, 3 …' });
    await expect(MaterialService.update({ id: m.id, unitOfMeasure: 'each', requiredStock: 3 }, 'admin')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR', message: 'Welding cable holds part of a unit (7.5 at Rack A), so it can\'t be counted in whole each yet. Count it to a whole number on Count stock first.',
    });
    db.balances[0]!.quantity = 8;
    expect((await MaterialService.update({ id: m.id, unitOfMeasure: 'each', requiredStock: 3 }, 'admin')).unitOfMeasure).toBe('each');
  });
});
