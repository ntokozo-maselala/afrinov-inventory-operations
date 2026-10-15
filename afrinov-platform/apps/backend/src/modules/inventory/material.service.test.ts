// Unit tests for MaterialService: the serial number a tool kept as one unit carries.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Material = { id: string; sku: string; name: string; category: string; serialNumber: string | null; [k: string]: unknown };
type SerialFilter = { equals: string; mode?: string };

const db = { materials: new Map<string, Material>(), audit: [] as Array<{ action: string; entityId: string }> };
let seq = 0;

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
    auditLogEntry: { create: async ({ data }: { data: { action: string; entityId: string } }) => { db.audit.push(data); return data; } },
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
