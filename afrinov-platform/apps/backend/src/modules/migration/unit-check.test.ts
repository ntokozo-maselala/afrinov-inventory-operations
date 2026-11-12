// The import's whole-unit check, shared by the dry run and the real import (system audit H6).
import { describe, it, expect } from 'vitest';
import { kindsFrom, partUnitProblems } from './unit-check.js';
import type { PlannedMaterial } from './mapping.js';

const item = (sku: string, unitOfMeasure: string, balances: Array<[string, number]>, requiredStock = 0): PlannedMaterial => ({
  sku, name: `${sku} name`, category: 'CONSUMABLES', unitOfMeasure, requiredStock, unitCost: null, serialNumber: null,
  oldProductIds: [`OLD-${sku}`], balances: balances.map(([location, quantity]) => ({ location, quantity })),
});

describe('partUnitProblems', () => {
  const listed = kindsFrom([{ code: 'each', kind: 'COUNTED' }, { code: 'length', kind: 'COUNTED' }, { code: 'm', kind: 'MEASURED' }, { code: 'tin', kind: 'COUNTED', active: false }]);

  it('names every counted item with part of a unit, with each place, and passes the rest', () => {
    const problems = partUnitProblems([
      item('STEEL-1', 'Length', [['Rack A', 1.5], ['Rack B', 2]]),
      item('PAINT-5L', 'ea', [['Paint store', 0.5]], 1.5),
      item('WIRE-2', 'm', [['Rack C', 12.25]]),
      item('BOLT-8', 'each', [['Rack D', 40]]),
    ], listed);
    expect(problems.map((p) => [p.code, p.detail])).toEqual([
      ['PART_UNIT', 'STEEL-1 is counted in length: 1.5 at Rack A'],
      ['PART_UNIT', 'PAINT-5L is counted in each: required stock 1.5, 0.5 at Paint store'],
    ]);
    expect(problems[0]).toMatchObject({ sheet: 'Items (mapping)', productId: 'OLD-STEEL-1', name: 'STEEL-1 name' });
  });

  it('refuses a unit not on the list, or taken out of use, as the real import does', () => {
    expect(partUnitProblems([item('X', 'bucket', [['A', 1]]), item('Y', 'tin', [['A', 1]])], listed).map((p) => p.code)).toEqual(['UNLISTED_UNIT', 'UNLISTED_UNIT']);
  });

  it('without a database, checks the units counted at release and takes the rest as measured', () => {
    const release = kindsFrom(null);
    expect(partUnitProblems([item('A', 'pair', [['R', 0.5]]), item('B', 'bucket', [['R', 0.5]])], release).map((p) => p.detail)).toEqual(['A is counted in pair: 0.5 at R']);
  });
});
