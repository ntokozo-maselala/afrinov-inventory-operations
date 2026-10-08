// The mapping file: suggestions, the Excel round trip, and the checks run
// when it is applied. Uses a made-up workbook; no real data.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import type { MaterialCategory } from '@prisma/client';
import { analyseWorkbook, RESOLVED_BY_MAPPING, type Analysis, type Problem, type ProblemCode } from './workbook-analysis.js';
import type { MainRow, NumberCell, WorkbookRead } from './workbook-reader.js';
import {
  applyMapping, guessLocationType, itemKey, readMappingSheets, suggestMapping, unitHint, NO_LOCATION, type Mapping,
} from './mapping.js';

const n = (value: number | null): NumberCell => ({ value });

function main(category: MaterialCategory, row: number, productId: string | null, name: string, location: string | null, qty: number): MainRow {
  return {
    category, sheet: `${category} Main`, row, productId, name, location,
    broughtForward: n(qty), currentStock: n(qty), in: n(0), out: n(0), requiredStock: n(5),
  };
}

function sample(): Analysis {
  const read: WorkbookRead = {
    mainRows: [
      main('CONSUMABLES', 2, 'P-001', 'Grinding disc', 'A-1', 10),
      main('CONSUMABLES', 3, 'P-002', 'Cutting fluid 5L', 'Stores', 4),
      main('CONSUMABLES', 4, 'P-003', 'Cutting fluid 5L', 'STORES', 1),
      main('CONSUMABLES', 5, 'P-004', 'Boiler chalk', 'stores', 2),
      main('TOOLING_PPE_ELECTRICAL', 2, 'P-001', 'Welding gloves (pair)', 'Stores Container', 6),
      main('PROJECT_MATERIAL', 2, null, 'Pipe', null, 3),
    ],
    summaryRows: [], summaryTotals: {}, summaryRowTotals: {}, missingSheets: [],
  };
  return analyseWorkbook(read);
}

async function roundTrip(mapping: Mapping, analysis: Analysis) {
  // Write with the real writer, then read back from the buffer.
  const { writeMappingFile } = await import('./mapping.js');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'mapping-'));
  try {
    await writeMappingFile(join(dir, 'mapping.xlsx'), mapping, analysis);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(dir, 'mapping.xlsx'));
    return { wb, ...readMappingSheets(wb) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const codes = (problems: Problem[], code: ProblemCode) => problems.filter((p) => p.code === code);

describe('suggested mapping', () => {
  it('gives every row its own SKU by category, "each" as the unit', () => {
    const m = suggestMapping(sample());
    expect(m.items.map((i) => i.sku)).toEqual(['CON-0001', 'CON-0002', 'CON-0003', 'CON-0004', 'TPE-0001', 'PRJ-0001']);
    expect(new Set(m.items.map((i) => i.unitOfMeasure))).toEqual(new Set(['each']));
  });

  it('maps every spelling of a place to its most used spelling, and leaves a blank location to the storeman', () => {
    const m = suggestMapping(sample());
    const stores = m.locations.filter((l) => l.asWritten?.toLowerCase() === 'stores');
    expect(stores.map((l) => l.platformName)).toEqual(['Stores', 'Stores', 'Stores']);
    expect(m.locations.find((l) => l.asWritten === null)).toEqual({ asWritten: null, platformName: null, type: null });
  });

  it('guesses location types from their names', () => {
    expect(guessLocationType('A-1')).toBe('RACK');
    expect(guessLocationType('E2')).toBe('RACK');
    expect(guessLocationType('Stores Container')).toBe('CONTAINER');
    expect(guessLocationType('Boiler Shop')).toBe('SHOP_FLOOR_AREA');
    expect(guessLocationType('Store room')).toBe('STOREROOM');
  });

  it('flags names that suggest another unit, but not sizes', () => {
    expect(unitHint('Cutting fluid 25L')).toBe('25L');
    expect(unitHint('Penetrant 400ML')).toBe('400ML');
    expect(unitHint('Insulation tape roll')).toBe('roll');
    expect(unitHint('Cutting disc 115mm')).toBeNull();
    expect(unitHint('OD25 x 4m EN8 bar')).toBeNull();
    expect(unitHint('Easy Out Set')).toBeNull();
  });
});

describe('mapping file', () => {
  it('survives the round trip through Excel', async () => {
    const analysis = sample();
    const suggested = suggestMapping(analysis);
    const { wb, mapping, problems } = await roundTrip(suggested, analysis);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Read me', 'Items', 'Locations']);
    expect(problems).toEqual([]);
    expect(mapping.items.map(({ row: _row, ...rest }) => rest)).toEqual(suggested.items);
    expect(mapping.locations.map(({ row: _row, ...rest }) => rest)).toEqual(suggested.locations);
  });

  it('applies cleanly once the blank location is chosen', async () => {
    const analysis = sample();
    const suggested = suggestMapping(analysis);
    suggested.locations.find((l) => l.asWritten === null)!.platformName = 'Stores';
    suggested.locations.find((l) => l.asWritten === null)!.type = 'STOREROOM';
    const { mapping } = await roundTrip(suggested, analysis);
    const result = applyMapping(analysis, mapping);
    expect(result.problems).toEqual([]);
    expect(result.materials).toHaveLength(6);
    expect(result.locations).toEqual([
      { name: 'A-1', type: 'RACK' }, { name: 'Stores', type: 'STOREROOM' }, { name: 'Stores Container', type: 'CONTAINER' },
    ]);
    expect(result.materials.find((m) => m.sku === 'PRJ-0001')?.balances).toEqual([{ location: 'Stores', quantity: 3 }]);
  });
});

describe('applying the mapping', () => {
  function suggestedFor(analysis: Analysis): Mapping {
    const m = suggestMapping(analysis);
    const blank = m.locations.find((l) => l.asWritten === null)!;
    blank.platformName = 'Stores';
    blank.type = 'STOREROOM';
    return m;
  }

  it('makes rows with the same SKU one item in several locations, adding Required Stock', () => {
    const analysis = sample();
    const m = suggestedFor(analysis);
    m.locations.find((l) => l.asWritten === 'A-1')!.platformName = 'Rack A-1';
    // Grinding disc (A-1) and boiler chalk (stores) under one SKU: different names, so flagged for review.
    m.items[3]!.sku = 'CON-0001';
    const result = applyMapping(analysis, m);
    const joined = result.materials.find((x) => x.sku === 'CON-0001')!;
    expect(joined.balances).toEqual([{ location: 'Rack A-1', quantity: 10 }, { location: 'Stores', quantity: 2 }]);
    expect(joined.requiredStock).toBe(10);
    expect(joined.oldProductIds).toEqual(['P-001', 'P-004']);
    expect(codes(result.problems, 'SKU_JOINS_DIFFERENT_NAMES')).toHaveLength(1);
  });

  it('refuses one SKU across categories, with two units, or twice in one location', () => {
    const analysis = sample();
    const m = suggestedFor(analysis);
    m.items[4]!.sku = 'CON-0001'; // tooling row
    m.items[2]!.sku = 'CON-0002'; // same item; "STORES" maps to Stores like row 3
    m.items[3]!.sku = 'CON-0004';
    const result = applyMapping(analysis, m);
    const conflicts = codes(result.problems, 'SKU_CONFLICT').map((p) => p.detail);
    expect(conflicts).toEqual([
      expect.stringContaining('CON-0001 is used in Consumables and Tooling, PPE & Electrical'),
      expect.stringContaining('CON-0002 is on two rows for Stores'),
    ]);
    expect(result.materials.map((x) => x.sku)).not.toContain('CON-0002');

    m.items[2]!.sku = 'CON-0003';
    m.items[4]!.sku = 'TPE-0001';
    m.items[0]!.sku = 'CON-0009';
    m.items[1]!.sku = 'CON-0009';
    m.items[1]!.unitOfMeasure = 'l';
    expect(codes(applyMapping(analysis, m).problems, 'SKU_CONFLICT').map((p) => p.detail))
      .toEqual([expect.stringContaining('CON-0009 has different units: each, l')]);
  });

  it('blocks rows missing from the mapping, a blank SKU or unit, and unmapped or untyped locations', () => {
    const analysis = sample();
    const m = suggestMapping(analysis); // blank location left unmapped
    m.items = m.items.filter((i) => i.itemName !== 'Boiler chalk');
    m.items[0]!.sku = null;
    m.items[1]!.unitOfMeasure = '';
    m.items[2]!.sku = 'bad sku!';
    m.locations.find((l) => l.asWritten === 'Stores Container')!.type = 'SHED';
    const result = applyMapping(analysis, m);
    expect(codes(result.problems, 'UNMAPPED_ITEM').map((p) => p.name)).toEqual(['Boiler chalk']);
    expect(codes(result.problems, 'MAPPING_ROW_INVALID').map((p) => p.detail)).toEqual([
      'No New SKU', 'No unit of measure', expect.stringContaining('SKU "bad sku!"'),
    ]);
    expect(codes(result.problems, 'UNMAPPED_LOCATION').map((p) => p.detail)).toEqual([`"${NO_LOCATION}" has no platform location in the Locations sheet`]);
    expect(codes(result.problems, 'MAPPING_LOCATION_INVALID').map((p) => p.detail)).toEqual([expect.stringContaining('type "SHED"')]);
  });

  it('notes mapping rows whose workbook row has gone', () => {
    const analysis = sample();
    const m = suggestedFor(analysis);
    m.items.push({ category: 'CONSUMABLES', oldProductId: 'P-999', itemName: 'Merged away', locationAsWritten: 'A-1', sku: 'CON-0099', unitOfMeasure: 'each', row: 99 });
    expect(codes(applyMapping(analysis, m).problems, 'UNUSED_MAPPING_ROW')).toEqual([expect.objectContaining({ row: 99, name: 'Merged away' })]);
  });

  it('matches rows by content, not position, ignoring spacing and case in the name', () => {
    const analysis = sample();
    const m = suggestedFor(analysis);
    m.items.reverse();
    m.items.find((i) => i.itemName === 'Grinding disc')!.itemName = '  GRINDING   disc ';
    expect(applyMapping(analysis, m).problems).toEqual([]);
    expect(itemKey({ category: 'CONSUMABLES', oldProductId: 'P-1', itemName: 'A  b', locationAsWritten: ' X ' }))
      .toBe(itemKey({ category: 'CONSUMABLES', oldProductId: 'P-1', name: 'a b', location: 'X' }));
  });

  it('settles the workbook problems that new SKUs and mapped spellings replace', () => {
    expect([...RESOLVED_BY_MAPPING].sort()).toEqual(['BLANK_LOCATION', 'DUPLICATE_PRODUCT_ID', 'LOCATION_SPELLINGS', 'MISSING_PRODUCT_ID', 'PRODUCT_ID_IN_SEVERAL_CATEGORIES']);
  });
});
