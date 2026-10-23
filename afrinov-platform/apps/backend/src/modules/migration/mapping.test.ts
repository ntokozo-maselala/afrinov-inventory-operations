// The mapping file: suggestions, the Excel round trip, and the checks run
// when it is applied. Uses a made-up workbook; no real data.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import type { MaterialCategory } from '@prisma/client';
import { analyseWorkbook, PROBLEM_TEXT, RESOLVED_BY_MAPPING, type Analysis, type Problem, type ProblemCode } from './workbook-analysis.js';
import type { MainRow, NumberCell, WorkbookRead } from './workbook-reader.js';
import {
  applyMapping, guessLocationType, itemKey, readMappingSheets, suggestMapping, suggestSerial, unitHint, NO_LOCATION, type Mapping,
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
    expect(m.locations.find((l) => l.asWritten === null)).toEqual({ asWritten: null, platformName: null, type: null, locatedIn: null });
    // Which room a rack is in is the storeman's to say: never guessed.
    expect(m.locations.every((l) => l.locatedIn === null)).toBe(true);
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
    suggested.locations.find((l) => l.asWritten === 'A-1')!.locatedIn = 'Stores';
    const { mapping } = await roundTrip(suggested, analysis);
    expect(mapping.locations.find((l) => l.asWritten === 'A-1')?.locatedIn).toBe('Stores');
    const result = applyMapping(analysis, mapping);
    expect(result.problems).toEqual([]);
    expect(result.materials).toHaveLength(6);
    // Rooms first, so each exists before the racks inside it.
    expect(result.locations).toEqual([
      { name: 'Stores', type: 'STOREROOM' }, { name: 'Stores Container', type: 'CONTAINER' }, { name: 'A-1', type: 'RACK', parent: 'Stores' },
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
    m.locations.find((l) => l.asWritten === 'A-1')!.locatedIn = 'Stores';
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
    m.items.push({ category: 'CONSUMABLES', oldProductId: 'P-999', itemName: 'Merged away', locationAsWritten: 'A-1', sku: 'CON-0099', unitOfMeasure: 'each', serialNumber: null, row: 99 });
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

describe('tools', () => {
  function tools(): Analysis {
    return analyseWorkbook({
      mainRows: [
        main('TOOLS', 2, null, 'Makita Hand Drill - 34322', 'O-1', 1),
        main('TOOLS', 3, null, 'Bosch GSB 570 Hand Drill- 128006542', 'O-1', 1),
        main('TOOLS', 4, null, 'Safety Harness (A grange) - 110446', 'Stores', 6),
        main('TOOLS', 5, null, 'Scraper', 'Stores', 11),
      ],
      summaryRows: [], summaryTotals: {}, summaryRowTotals: {}, missingSheets: [],
    });
  }

  it('takes a serial number from the end of a single tool\'s name, not from a set\'s', () => {
    expect(suggestSerial('Makita Hand Drill - 34322', 1)).toBe('34322');
    expect(suggestSerial('Bosch GSB 570 Hand Drill- 128006542', 1)).toBe('128006542');
    expect(suggestSerial('Grease Drum - ADF1381-06282022', 1)).toBe('ADF1381-06282022');
    expect(suggestSerial('Big Grinder - Bosch Professional GWS-220 - 131000670', 1)).toBe('131000670');
    expect(suggestSerial('Safety Harness (A grange) - 110446', 6)).toBeNull();
    expect(suggestSerial('Bosch GSB 570 Hand Drill', 1)).toBeNull();
    expect(suggestSerial('Drill 6mm - 1234', 1)).toBeNull();
  });

  it('suggests TL- SKUs and the serial numbers, which survive the Excel round trip', async () => {
    const analysis = tools();
    const m = suggestMapping(analysis);
    expect(m.items.map((i) => [i.sku, i.serialNumber])).toEqual([['TL-0001', '34322'], ['TL-0002', '128006542'], ['TL-0003', null], ['TL-0004', null]]);
    m.locations.find((l) => l.asWritten === 'O-1')!.locatedIn = 'Tool Store';
    const { mapping, problems } = await roundTrip(m, analysis);
    expect(problems).toEqual([]);
    expect(mapping.items.map((i) => i.serialNumber)).toEqual(['34322', '128006542', null, null]);
    const result = applyMapping(analysis, mapping);
    expect(result.problems).toEqual([]);
    expect(result.materials.map((x) => [x.sku, x.category, x.serialNumber, x.balances[0]!.quantity])).toEqual([
      ['TL-0001', 'TOOLS', '34322', 1], ['TL-0002', 'TOOLS', '128006542', 1], ['TL-0003', 'TOOLS', null, 6], ['TL-0004', 'TOOLS', null, 11],
    ]);
  });

  it('refuses a serial number on a set, on something that is not a tool, or on two tools', () => {
    const analysis = analyseWorkbook({
      mainRows: [...tools().items.map((i, k) => main('TOOLS', k + 2, null, i.name, i.location, i.quantity)), main('CONSUMABLES', 2, 'P-1', 'Disc', 'A-1', 1)],
      summaryRows: [], summaryTotals: {}, summaryRowTotals: {}, missingSheets: [],
    });
    const m = suggestMapping(analysis);
    m.items.find((i) => i.itemName === 'Scraper')!.serialNumber = 'SC-99999';
    m.items.find((i) => i.itemName === 'Disc')!.serialNumber = '55555';
    m.items.find((i) => i.sku === 'TL-0002')!.serialNumber = '34322';
    const { problems, materials } = applyMapping(analysis, m);
    expect(codes(problems, 'MAPPING_ROW_INVALID').map((p) => p.detail)).toEqual([
      expect.stringContaining('on 11 tools: a serial number is for one tool'),
      expect.stringContaining('only tools have one'),
    ]);
    expect(codes(problems, 'SKU_CONFLICT')).toEqual([expect.objectContaining({ detail: 'Serial number "34322" is given to TL-0001, TL-0002; each tool has its own' })]);
    expect(materials.map((x) => x.sku)).not.toContain('TL-0001');
  });

  it('keeps each of several identical tool rows as its own tool, matched in order', () => {
    const analysis = analyseWorkbook({
      mainRows: [1, 2, 3].map((k) => main('TOOLS', k + 1, null, 'Angle grinder GWS 11-125P', 'P-2', 1)),
      summaryRows: [], summaryTotals: {}, summaryRowTotals: {}, missingSheets: [],
    });
    expect(codes(analysis.problems, 'DUPLICATE_ROW')).toEqual([]);
    expect(codes(analysis.problems, 'TOOL_ON_SEVERAL_ROWS').map((p) => p.row)).toEqual([3, 4]);
    const m = suggestMapping(analysis);
    m.items[2]!.serialNumber = 'GWS-77777';
    const result = applyMapping(analysis, m);
    expect(result.problems.map((p) => p.code)).toEqual(['RACK_WITHOUT_ROOM']);
    expect(result.materials.map((x) => [x.sku, x.serialNumber])).toEqual([['TL-0001', null], ['TL-0002', null], ['TL-0003', 'GWS-77777']]);
  });
});

describe('which room each rack is in', () => {
  function racks(): Analysis {
    return analyseWorkbook({
      mainRows: [
        main('CONSUMABLES', 2, 'P-1', 'Disc', 'D-1', 4),
        main('CONSUMABLES', 3, 'P-2', 'Gloves', 'd1', 2),
        main('CONSUMABLES', 4, 'P-3', 'Chalk', 'F-7', 1),
        main('CONSUMABLES', 5, 'P-4', 'Tape', 'Stores', 3),
        main('CONSUMABLES', 6, 'P-5', 'Rope', 'Stores Container', 1),
      ],
      summaryRows: [], summaryTotals: {}, summaryRowTotals: {}, missingSheets: [],
    });
  }
  const locate = (m: Mapping, asWritten: string, locatedIn: string | null) => { m.locations.find((l) => l.asWritten === asWritten)!.locatedIn = locatedIn; };

  it('puts each rack in the room named, on one spelling or all, and creates a room that holds no stock', () => {
    const analysis = racks();
    const m = suggestMapping(analysis);
    locate(m, 'D-1', 'main storeroom');
    locate(m, 'F-7', 'Main  Storeroom');
    locate(m, 'Stores Container', 'stores');
    const result = applyMapping(analysis, m);
    expect(result.problems).toEqual([]);
    expect(result.locations).toEqual([
      { name: 'main storeroom', type: 'STOREROOM' },
      { name: 'Stores', type: 'STOREROOM' },
      { name: 'D-1', type: 'RACK', parent: 'main storeroom' },
      { name: 'F-7', type: 'RACK', parent: 'main storeroom' },
      { name: 'Stores Container', type: 'CONTAINER', parent: 'Stores' },
    ].sort((a, b) => Number(!!a.parent) - Number(!!b.parent) || a.name.localeCompare(b.name)));
  });

  it('names a rack with no room for review, without blocking the import', () => {
    const analysis = racks();
    const m = suggestMapping(analysis);
    locate(m, 'D-1', 'Stores');
    const result = applyMapping(analysis, m);
    expect(result.problems).toEqual([expect.objectContaining({ code: 'RACK_WITHOUT_ROOM', detail: '"F-7" has no Located in' })]);
    expect(PROBLEM_TEXT.RACK_WITHOUT_ROOM.severity).toBe('review');
    expect(result.locations.find((l) => l.name === 'F-7')).toEqual({ name: 'F-7', type: 'RACK' });
  });

  it('refuses a room that is a rack, a second level, the place itself, or two rooms for one place', () => {
    const analysis = racks();
    const m = suggestMapping(analysis);
    locate(m, 'D-1', 'F-7');
    locate(m, 'F-7', 'Stores Container');
    locate(m, 'Stores Container', 'Stores');
    locate(m, 'Stores', 'stores');
    const twoRooms = suggestMapping(analysis);
    locate(twoRooms, 'D-1', 'Stores');
    locate(twoRooms, 'd1', 'Main Storeroom');
    expect(codes(applyMapping(analysis, m).problems, 'MAPPING_LOCATION_INVALID').map((p) => p.detail)).toEqual([
      '"Stores" is located in itself',
      '"D-1": "F-7" is a rack; a location can be inside a room or area, not a rack',
      '"F-7": "Stores Container" is itself located in Stores; locations go one level deep',
    ]);
    const result = applyMapping(analysis, twoRooms);
    expect(codes(result.problems, 'MAPPING_LOCATION_INVALID').map((p) => p.detail)).toEqual(['"D-1" is located in two rooms: Stores and Main Storeroom']);
    expect(result.locations.find((l) => l.name === 'D-1')).toEqual({ name: 'D-1', type: 'RACK', parent: 'Stores' });
  });

  it('reads a mapping file written before Located in was asked for', async () => {
    const analysis = racks();
    const { wb } = await roundTrip(suggestMapping(analysis), analysis);
    const sheet = wb.getWorksheet('Locations')!;
    expect(sheet.getRow(1).getCell(5).value).toBe('Located in');
    sheet.spliceColumns(5, 1);
    const { mapping, problems } = readMappingSheets(wb);
    expect(problems).toEqual([]);
    expect(mapping.locations.every((l) => l.locatedIn === null)).toBe(true);
  });
});

describe('older mapping files', () => {
  it('reads an Items sheet with no serial number column', async () => {
    const analysis = sample();
    const { wb } = await roundTrip(suggestMapping(analysis), analysis);
    const sheet = wb.getWorksheet('Items')!;
    expect(sheet.getRow(1).getCell(9).value).toBe('Serial number (tools)');
    sheet.spliceColumns(9, 1);
    const { mapping, problems } = readMappingSheets(wb);
    expect(problems).toEqual([]);
    expect(mapping.items.every((i) => i.serialNumber === null)).toBe(true);
  });
});

describe('problem text', () => {
  it('says the Locations sheet problem covers the room as well as the type', () => {
    expect(PROBLEM_TEXT.MAPPING_LOCATION_INVALID.title).toBe('Location type or room missing or wrong');
    expect(PROBLEM_TEXT.MAPPING_LOCATION_INVALID.resolution).toMatch(/Located in/);
  });
});
