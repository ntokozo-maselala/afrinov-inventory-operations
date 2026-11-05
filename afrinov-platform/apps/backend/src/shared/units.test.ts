import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { COUNTED_AT_RELEASE, UNIT_ALIASES, unitCode, fitsUnitKind, checkWholeUnits, checkUnitOfMeasure, checkQuantityForUnit } from './units.js';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('unitCode', () => {
  it('maps every spelling of a listed unit to its code, ignoring case and spaces', () => {
    expect(unitCode('EA')).toBe('each');
    expect(unitCode(' Pcs ')).toBe('each');
    expect(unitCode('Metres')).toBe('m');
    expect(unitCode('KGS')).toBe('kg');
    expect(unitCode('m²')).toBe('m2');
  });

  it('leaves a spelling it does not know as typed, trimmed', () => {
    expect(unitCode(' gross ')).toBe('gross');
  });

  // The migration that created the list mapped existing items with its own
  // copy of this table; new items and imports use this one.
  it('matches the spellings the units migration mapped', () => {
    const sql = readFileSync(new URL('../../prisma/migrations/20260101000047_units_of_measure/migration.sql', import.meta.url), 'utf8');
    const block = sql.slice(sql.indexOf('FROM (VALUES'), sql.indexOf(') AS a("alias", "code")'));
    const pairs = Object.fromEntries([...block.matchAll(/\('([^']+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(UNIT_ALIASES);
    const listed = [...sql.matchAll(/^\s+\('([^']+)',\s+'[^']+',\s+'(COUNTED|MEASURED)'/gm)];
    expect(listed.map((m) => m[1]).sort()).toEqual([...new Set(Object.values(UNIT_ALIASES))].sort());
    expect(listed.filter((m) => m[2] === 'COUNTED').map((m) => m[1]).sort()).toEqual([...COUNTED_AT_RELEASE].sort());
  });
});

describe('fitsUnitKind', () => {
  it('takes whole numbers only for a counted unit', () => {
    expect(fitsUnitKind('COUNTED', D(80))).toBe(true);
    expect(fitsUnitKind('COUNTED', D(-80))).toBe(true);
    expect(fitsUnitKind('COUNTED', D('0.0001'))).toBe(false);
    expect(fitsUnitKind('COUNTED', D('2.5'))).toBe(false);
  });

  it('takes exactly the remainder of a counted item, so part-units from before the rule can be closed off', () => {
    expect(fitsUnitKind('COUNTED', D('0.5'), D('0.5'))).toBe(true);
    expect(fitsUnitKind('COUNTED', D('0.5'), D('2.5'))).toBe(false);
    expect(fitsUnitKind('COUNTED', D('2'), D('2.5'))).toBe(true);
  });

  it('takes fractions for a measured unit', () => {
    expect(fitsUnitKind('MEASURED', D('2.5'))).toBe(true);
    expect(fitsUnitKind('MEASURED', D('0.0001'))).toBe(true);
  });
});

describe('checkWholeUnits', () => {
  const db = {
    material: {
      findMany: async () => [
        { id: 'washer', name: 'M16 flat washer', unitOfMeasure: 'each', unit: { kind: 'COUNTED' as const } },
        { id: 'cable', name: 'Welding cable', unitOfMeasure: 'm', unit: { kind: 'MEASURED' as const } },
      ],
    },
  } as unknown as Parameters<typeof checkWholeUnits>[1];

  it('refuses part of a counted item, naming the item and its unit', async () => {
    await expect(checkWholeUnits([{ materialId: 'cable', quantity: 2.5 }, { materialId: 'washer', quantity: '0.0001' }], db))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'M16 flat washer is counted in whole numbers (each). Enter 1, 2, 3 …' });
  });

  it('passes whole counted quantities and fractions of measured ones', async () => {
    await expect(checkWholeUnits([{ materialId: 'washer', quantity: 80 }, { materialId: 'cable', quantity: 2.5 }], db)).resolves.toBeUndefined();
  });

  it('leaves an item it cannot find to the caller', async () => {
    await expect(checkWholeUnits([{ materialId: 'missing', quantity: 0.5 }], db)).resolves.toBeUndefined();
  });
});

describe('checkUnitOfMeasure', () => {
  const units: Record<string, { code: string; kind: 'COUNTED' | 'MEASURED'; active: boolean }> = {
    each: { code: 'each', kind: 'COUNTED', active: true },
    gross: { code: 'gross', kind: 'COUNTED', active: false },
  };
  const db = { unitOfMeasure: { findUnique: async ({ where }: { where: { code: string } }) => units[where.code] ?? null } } as unknown as Parameters<typeof checkUnitOfMeasure>[1];

  it('takes any spelling of a listed unit and answers its code and kind', async () => {
    await expect(checkUnitOfMeasure('EA', db)).resolves.toEqual({ code: 'each', kind: 'COUNTED' });
  });

  it('refuses a unit that is not on the list, or no longer in use', async () => {
    await expect(checkUnitOfMeasure('bundle', db)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: '"bundle" is not a unit on the list. Choose one, such as each, pair, box, m or kg.' });
    await expect(checkUnitOfMeasure('gross', db)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('checkQuantityForUnit', () => {
  it('refuses part of a counted unit for an item not saved yet', () => {
    expect(() => checkQuantityForUnit('Glove', { code: 'pair', kind: 'COUNTED' }, 2.5, 'requiredStock'))
      .toThrow('Glove is counted in whole numbers (pair). Enter 1, 2, 3 …');
    expect(() => checkQuantityForUnit('Cable', { code: 'm', kind: 'MEASURED' }, 2.5, 'requiredStock')).not.toThrow();
  });
});
