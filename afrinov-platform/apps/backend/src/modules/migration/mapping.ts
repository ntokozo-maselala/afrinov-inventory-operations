// The mapping file: an Excel workbook the storeman and buyer review before the
// import. It gives each workbook row its new SKU and unit of measure, and each
// location spelling the platform location it belongs to. The first dry run
// writes it with suggestions; later runs read it back and check it.
//
// Rows are matched by category, old Product ID, item name and location as
// written, not by row number, so editing the stock workbook (merging the
// duplicate rows, say) does not unhook the rest of the mapping. Identical tool
// rows (each tool of one model on its own row) are matched in order: the
// second such workbook row with the second such mapping row.
import ExcelJS from 'exceljs';
import type { LocationType, MaterialCategory } from '@prisma/client';
import { CATEGORY_SHEETS, textOf } from './workbook-reader.js';
import { CATEGORY_LABEL, type Analysis, type PlannedItem, type Problem } from './workbook-analysis.js';

export interface ItemMapping {
  category: MaterialCategory;
  oldProductId: string | null;
  itemName: string;
  locationAsWritten: string | null;
  sku: string | null;
  unitOfMeasure: string | null;
  /** Tools kept as one unit: the serial number. */
  serialNumber: string | null;
  /** Row in the mapping file, for messages. */
  row?: number;
}

export interface LocationMapping {
  asWritten: string | null;
  platformName: string | null;
  type: string | null;
  /** The room or area the location stands in (a rack's room), by its platform name. */
  locatedIn: string | null;
  row?: number;
}

export interface Mapping { items: ItemMapping[]; locations: LocationMapping[] }

/** One platform item to create, with its opening stock per location. */
export interface PlannedMaterial {
  sku: string;
  name: string;
  category: MaterialCategory;
  unitOfMeasure: string;
  requiredStock: number;
  unitCost: number | null;
  serialNumber: string | null;
  oldProductIds: string[];
  balances: Array<{ location: string; quantity: number }>;
}

/** A location to create or reuse; `parent` is the room it stands in, planned before it. */
export interface PlannedLocation { name: string; type: LocationType; parent?: string }

export const LOCATION_TYPES: LocationType[] = ['RACK', 'STOREROOM', 'SHOP_FLOOR_AREA', 'CONTAINER', 'OFF_SITE'];
export const COMMON_UNITS = ['each', 'm', 'kg', 'l', 'box', 'pack', 'pair', 'roll', 'set', 'sheet', 'tube', 'can'];
/** How a blank location is shown in the mapping file. */
export const NO_LOCATION = '(no location)';

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const locationKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const categoryByLabel = new Map(Object.entries(CATEGORY_LABEL).map(([k, v]) => [v.toLowerCase(), k as MaterialCategory]));

export function itemKey(r: { category: MaterialCategory; oldProductId: string | null; itemName?: string; name?: string; locationAsWritten?: string | null; location?: string | null }): string {
  const name = r.itemName ?? r.name ?? '';
  const loc = r.locationAsWritten !== undefined ? r.locationAsWritten : r.location;
  return [r.category, (r.oldProductId ?? '').trim(), nameKey(name), (loc ?? '').replace(/\s+/g, ' ').trim()].join('|');
}

/** Words in an item name that suggest it is not counted in units ("each"). */
export function unitHint(name: string): string | null {
  // Sizes such as 115mm or 4m describe the item, not how it is counted, so they
  // are not hints; nor is "set", which is counted as one.
  const m = name.match(/\d+(?:[.,]\d+)?\s*(kg|lt?|litres?|liters?|ml)\b|\bper\s+(m|metre|meter|kg|box|roll|pack)\b|\b(rolls?|box(es)?|packs?|pkts?|tins?|drums?|bags?|pairs?|litres?)\b/i);
  return m ? m[0].trim() : null;
}

/**
 * The serial number a tool's name ends with ("Makita Hand Drill - 34322"): a
 * code with at least five digits after the last dash and space; it may hold a
 * dash itself ("Grease Drum - ADF1381-06282022"). Only for a single tool; a number
 * on a set ("Safety Harness - 110446", six of them) is a model, not a serial.
 */
export function suggestSerial(name: string, quantity: number): string | null {
  if (quantity !== 1) return null;
  const m = name.match(/[-\u2013]\s+([A-Za-z0-9/-]*\d{5,}[A-Za-z0-9/]*)\s*$/);
  return m ? m[1]! : null;
}

/** Best guess at the kind of place, from its name. */
export function guessLocationType(name: string): LocationType {
  const n = name.toLowerCase();
  if (/^[a-z]{1,2}\s*-?\s*\d+[a-z]?$/.test(n)) return 'RACK';
  if (n.includes('container')) return 'CONTAINER';
  if (/shop|floor|workshop|bay/.test(n)) return 'SHOP_FLOOR_AREA';
  if (/site|off.?site|client/.test(n)) return 'OFF_SITE';
  return 'STOREROOM';
}

/** The spelling to suggest for a group: the most used, preferring mixed case and spaces on a tie. */
function preferredSpelling(spellings: Array<{ text: string; rows: number }>): string {
  const score = (t: string) => (t !== t.toUpperCase() && t !== t.toLowerCase() ? 2 : 0) + (t.includes(' ') ? 1 : 0);
  return [...spellings].sort((a, b) => b.rows - a.rows || score(b.text) - score(a.text))[0]!.text;
}

/** First mapping: a new SKU per row in sheet order, "each", and one location per spelling group. */
export function suggestMapping(analysis: Analysis): Mapping {
  const next = new Map<MaterialCategory, number>();
  const prefix = new Map(CATEGORY_SHEETS.map((c) => [c.category, c.skuPrefix]));
  const items = analysis.items.map((i): ItemMapping => {
    const n = (next.get(i.category) ?? 0) + 1;
    next.set(i.category, n);
    return {
      category: i.category,
      oldProductId: i.oldProductId,
      itemName: i.name,
      locationAsWritten: i.location,
      sku: `${prefix.get(i.category)}-${String(n).padStart(4, '0')}`,
      unitOfMeasure: 'each',
      serialNumber: i.category === 'TOOLS' ? suggestSerial(i.name, i.quantity) : null,
    };
  });
  const locations: LocationMapping[] = [];
  for (const group of analysis.locations) {
    const platformName = preferredSpelling(group.spellings);
    for (const s of group.spellings) locations.push({ asWritten: s.text, platformName, type: guessLocationType(platformName), locatedIn: null });
  }
  if (analysis.items.some((i) => !i.location)) locations.push({ asWritten: null, platformName: null, type: null, locatedIn: null });
  return { items, locations };
}

// ── The Excel file ────────────────────────────────────────────────────

const ITEM_COLUMNS = [
  { header: 'Category', key: 'category', width: 28, fromWorkbook: true },
  { header: 'Old Product ID', key: 'oldProductId', width: 14, fromWorkbook: true },
  { header: 'Item name', key: 'itemName', width: 48, fromWorkbook: true },
  { header: 'Location as written', key: 'location', width: 20, fromWorkbook: true },
  { header: 'Quantity', key: 'quantity', width: 10, fromWorkbook: true },
  { header: 'Unit price excl. VAT', key: 'unitPrice', width: 12, fromWorkbook: true },
  { header: 'New SKU', key: 'sku', width: 14, fromWorkbook: false },
  { header: 'Unit of measure', key: 'unit', width: 14, fromWorkbook: false },
  { header: 'Serial number (tools)', key: 'serial', width: 18, fromWorkbook: false },
  { header: 'Check the unit? (word found in the name)', key: 'hint', width: 22, fromWorkbook: true },
] as const;

const LOCATION_COLUMNS = [
  { header: 'Location as written', key: 'asWritten', width: 24, fromWorkbook: true },
  { header: 'Rows', key: 'rows', width: 8, fromWorkbook: true },
  { header: 'Platform location', key: 'platformName', width: 24, fromWorkbook: false },
  { header: 'Type', key: 'type', width: 18, fromWorkbook: false },
  { header: 'Located in', key: 'locatedIn', width: 24, fromWorkbook: false },
] as const;

const README = [
  'Mapping file for the stock workbook import',
  '',
  'Fill in or correct the white columns only. Grey columns come from the stock workbook; change those in the workbook itself.',
  '',
  'Items sheet',
  '- New SKU: the item code in the platform. Suggested as CON-0001, FSI-0001, TPE-0001, PRJ-0001 and TL-0001 by category.',
  '- Give two rows the same SKU to make them one item kept in two locations. They must be in the same category and use the same unit.',
  '- Unit of measure: how the item is counted (each, m, kg, l, box, ...). Every item starts as "each"; check the rows with a word in the last column.',
  '- Serial number (tools): for a single tool, the maker\'s serial number. Suggested from a number at the end of the tool\'s name; leave it blank for a set of identical tools, and for everything that is not a tool.',
  '- Tools: the Tools sheet\'s Required Tools is read as how many the store owns. Tools that are really consumables (blades, inserts) can move to Tooling, PPE & Electrical: change the category in the stock workbook.',
  '',
  'Locations sheet',
  '- Platform location: the one name to use for that spelling. Give every spelling of the same place the same platform location.',
  '- Type: RACK, STOREROOM, SHOP_FLOOR_AREA, CONTAINER or OFF_SITE.',
  '- Located in: for a rack, the room it stands in (for D-1, say, Main Storeroom). Use the platform location name of a room or area; one that is not on this sheet is created as a STOREROOM. One level only: a room cannot itself be located in another, and nothing is located in a rack. Fill it in on one spelling of the place, or the same on each.',
  '',
  'Then save this file and run the dry run again. It reads this file and reports anything still missing.',
];

function styleHeader(ws: ExcelJS.Worksheet, columns: ReadonlyArray<{ fromWorkbook: boolean }>) {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: 'top' };
  columns.forEach((c, i) => {
    header.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fromWorkbook ? 'FFD9D9D9' : 'FFFFF2CC' } };
  });
}

function greyColumns(ws: ExcelJS.Worksheet, columns: ReadonlyArray<{ fromWorkbook: boolean }>, rows: number) {
  columns.forEach((c, i) => {
    if (!c.fromWorkbook) return;
    for (let r = 2; r <= rows + 1; r++) {
      ws.getRow(r).getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    }
  });
}

export async function writeMappingFile(path: string, mapping: Mapping, analysis: Analysis): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const readme = wb.addWorksheet('Read me');
  readme.getColumn(1).width = 120;
  README.forEach((line, i) => {
    readme.getRow(i + 1).getCell(1).value = line;
    if (i === 0) readme.getRow(1).font = { bold: true, size: 14 };
  });

  const planned = new Map(analysis.items.map((i) => [itemKey(i), i]));
  const items = wb.addWorksheet('Items');
  items.columns = ITEM_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  for (const m of mapping.items) {
    const p: PlannedItem | undefined = planned.get(itemKey(m));
    const row = items.addRow({
      category: CATEGORY_LABEL[m.category],
      oldProductId: m.oldProductId,
      itemName: m.itemName,
      location: m.locationAsWritten ?? NO_LOCATION,
      quantity: p?.quantity ?? null,
      unitPrice: p?.unitPrice ?? null,
      sku: m.sku,
      unit: m.unitOfMeasure,
      serial: m.serialNumber,
      hint: unitHint(m.itemName),
    });
    row.getCell(8).dataValidation = {
      type: 'list', allowBlank: false, formulae: [`"${COMMON_UNITS.join(',')}"`],
      showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Unit of measure', error: 'Not one of the usual units. Keep it anyway?',
    };
  }
  styleHeader(items, ITEM_COLUMNS);
  greyColumns(items, ITEM_COLUMNS, mapping.items.length);
  items.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ITEM_COLUMNS.length } };

  const rowsBySpelling = new Map<string, number>();
  for (const g of analysis.locations) for (const s of g.spellings) rowsBySpelling.set(s.text, s.rows);
  const locations = wb.addWorksheet('Locations');
  locations.columns = LOCATION_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  for (const l of mapping.locations) {
    const row = locations.addRow({
      asWritten: l.asWritten ?? NO_LOCATION,
      rows: rowsBySpelling.get(l.asWritten ?? '') ?? analysis.items.filter((i) => !i.location).length,
      platformName: l.platformName,
      type: l.type,
      locatedIn: l.locatedIn,
    });
    row.getCell(4).dataValidation = {
      type: 'list', allowBlank: false, formulae: [`"${LOCATION_TYPES.join(',')}"`],
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Type', error: `Choose one of ${LOCATION_TYPES.join(', ')}.`,
    };
  }
  styleHeader(locations, LOCATION_COLUMNS);
  greyColumns(locations, LOCATION_COLUMNS, mapping.locations.length);

  await wb.xlsx.writeFile(path);
}

function columnsByHeader(ws: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => { const t = textOf(cell.value); if (t) map.set(t.toLowerCase(), col); });
  return map;
}

/** A cell by its column header; null when the file has no such column (one written by an earlier version). */
function cellText(row: ExcelJS.Row, columns: Map<string, number>, header: string): string | null {
  const col = columns.get(header.toLowerCase());
  return col ? textOf(row.getCell(col).value) : null;
}

export async function readMappingFile(path: string): Promise<{ mapping: Mapping; problems: Problem[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return readMappingSheets(wb);
}

export function readMappingSheets(wb: ExcelJS.Workbook): { mapping: Mapping; problems: Problem[] } {
  const problems: Problem[] = [];
  const mapping: Mapping = { items: [], locations: [] };
  const sheetNames = { items: 'Items', locations: 'Locations' };

  const items = wb.getWorksheet(sheetNames.items);
  const locations = wb.getWorksheet(sheetNames.locations);
  for (const [ws, name] of [[items, sheetNames.items], [locations, sheetNames.locations]] as const) {
    if (!ws) problems.push({ code: 'MAPPING_SHEET_MISSING', sheet: name, detail: `The mapping file has no "${name}" sheet` });
  }

  if (items) {
    const c = columnsByHeader(items);
    const get = (row: ExcelJS.Row, header: string) => cellText(row, c, header);
    for (let r = 2; r <= items.rowCount; r++) {
      const row = items.getRow(r);
      const label = get(row, 'Category');
      const itemName = get(row, 'Item name');
      if (!label && !itemName) continue;
      const category = label ? categoryByLabel.get(label.toLowerCase()) : undefined;
      if (!category || !itemName) {
        problems.push({ code: 'MAPPING_ROW_INVALID', sheet: 'Items', row: r, name: itemName, detail: !category ? `Unknown category "${label ?? ''}"` : 'No item name' });
        continue;
      }
      const location = get(row, 'Location as written');
      mapping.items.push({
        category,
        oldProductId: get(row, 'Old Product ID'),
        itemName,
        locationAsWritten: location === NO_LOCATION ? null : location,
        sku: get(row, 'New SKU'),
        unitOfMeasure: get(row, 'Unit of measure'),
        // Absent from mapping files written before tools were imported.
        serialNumber: get(row, 'Serial number (tools)'),
        row: r,
      });
    }
  }

  if (locations) {
    const c = columnsByHeader(locations);
    if (!c.has('located in')) {
      problems.push({ code: 'MAPPING_COLUMN_MISSING', sheet: 'Locations', detail: 'No "Located in" column, so no rack can be given its room' });
    }
    const get = (row: ExcelJS.Row, header: string) => cellText(row, c, header);
    for (let r = 2; r <= locations.rowCount; r++) {
      const row = locations.getRow(r);
      const asWritten = get(row, 'Location as written');
      if (!asWritten) continue;
      mapping.locations.push({
        asWritten: asWritten === NO_LOCATION ? null : asWritten,
        platformName: get(row, 'Platform location'),
        type: get(row, 'Type')?.toUpperCase().replace(/[\s-]+/g, '_') ?? null,
        // Absent from mapping files written before rooms were asked for.
        locatedIn: get(row, 'Located in'),
        row: r,
      });
    }
  }
  return { mapping, problems };
}

// ── Applying it ───────────────────────────────────────────────────────

export interface MappedImport {
  materials: PlannedMaterial[];
  locations: PlannedLocation[];
  problems: Problem[];
}

/**
 * Checks the mapping against the workbook and works out what the import would
 * create. Every workbook row needs a mapping row with a SKU and unit, and every
 * location spelling a platform location and type; a rack should name its room.
 */
export function applyMapping(analysis: Analysis, mapping: Mapping): MappedImport {
  const problems: Problem[] = [];
  const at = (m: ItemMapping): Pick<Problem, 'category' | 'sheet' | 'row' | 'productId' | 'name'> =>
    ({ category: m.category, sheet: 'Items (mapping)', row: m.row, productId: m.oldProductId, name: m.itemName });

  // Locations.
  const locationBySpelling = new Map<string, LocationMapping>();
  for (const l of mapping.locations) locationBySpelling.set((l.asWritten ?? NO_LOCATION).replace(/\s+/g, ' ').trim(), l);
  const typeByPlatform = new Map<string, LocationType>();
  const canonical = new Map<string, string>();
  for (const l of mapping.locations) {
    if (!l.platformName) continue;
    const key = locationKey(l.platformName);
    if (!canonical.has(key)) canonical.set(key, l.platformName);
    if (l.type && !LOCATION_TYPES.includes(l.type as LocationType)) {
      problems.push({ code: 'MAPPING_LOCATION_INVALID', sheet: 'Locations (mapping)', row: l.row, detail: `"${l.asWritten ?? NO_LOCATION}": type "${l.type}" is not one of ${LOCATION_TYPES.join(', ')}` });
      continue;
    }
    if (!l.type) {
      problems.push({ code: 'MAPPING_LOCATION_INVALID', sheet: 'Locations (mapping)', row: l.row, detail: `"${l.asWritten ?? NO_LOCATION}": no type` });
      continue;
    }
    const name = canonical.get(key)!;
    const before = typeByPlatform.get(name);
    if (before && before !== l.type) {
      problems.push({ code: 'MAPPING_LOCATION_INVALID', sheet: 'Locations (mapping)', row: l.row, detail: `"${name}" is given two types: ${before} and ${l.type}` });
    } else {
      typeByPlatform.set(name, l.type as LocationType);
    }
  }
  // Rooms: the location each one stands in, by platform name. One level, as on the Locations page.
  const loc = 'Locations (mapping)';
  const roomOf = new Map<string, { room: string; row?: number }>();
  for (const l of mapping.locations) {
    if (!l.platformName || !l.locatedIn) continue;
    const name = canonical.get(locationKey(l.platformName))!;
    // A room not on the sheet takes its first spelling, as a platform location does.
    if (!canonical.has(locationKey(l.locatedIn))) canonical.set(locationKey(l.locatedIn), l.locatedIn.replace(/\s+/g, ' ').trim());
    const room = canonical.get(locationKey(l.locatedIn))!;
    const before = roomOf.get(name);
    if (locationKey(room) === locationKey(name)) {
      problems.push({ code: 'MAPPING_LOCATION_INVALID', sheet: loc, row: l.row, detail: `"${name}" is located in itself` });
    } else if (before && before.room !== room) {
      problems.push({ code: 'MAPPING_LOCATION_INVALID', sheet: loc, row: l.row, detail: `"${name}" is located in two rooms: ${before.room} and ${room}` });
    } else {
      roomOf.set(name, { room, row: l.row });
    }
  }
  const badRoom = new Set<string>();
  for (const [name, { room, row }] of roomOf) {
    const why = typeByPlatform.get(room) === 'RACK'
      ? `"${room}" is a rack; a location can be inside a room or area, not a rack`
      : roomOf.has(room) ? `"${room}" is itself located in ${roomOf.get(room)!.room}; locations go one level deep` : null;
    if (why) { problems.push({ code: 'MAPPING_LOCATION_INVALID', sheet: loc, row, detail: `"${name}": ${why}` }); badRoom.add(name); }
  }
  for (const name of badRoom) roomOf.delete(name);

  const platformLocationOf = (asWritten: string | null): string | null => {
    const l = locationBySpelling.get((asWritten ?? NO_LOCATION).replace(/\s+/g, ' ').trim());
    return l?.platformName ? canonical.get(locationKey(l.platformName))! : null;
  };
  const reportedSpellings = new Set<string>();

  // Items. A repeat of a tool row is the next tool of that model, so it is numbered.
  const numbered = () => {
    const seen = new Map<string, number>();
    return (r: Parameters<typeof itemKey>[0]) => {
      const key = itemKey(r);
      if (r.category !== 'TOOLS') return key;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return n === 1 ? key : `${key}#${n}`;
    };
  };
  const mappingKey = numbered();
  const keyOf = new Map<ItemMapping, string>(mapping.items.map((m) => [m, mappingKey(m)]));
  const byKey = new Map<string, ItemMapping>();
  for (const m of mapping.items) {
    const key = keyOf.get(m)!;
    if (byKey.has(key)) problems.push({ code: 'MAPPING_ROW_INVALID', ...at(m), detail: `Same row as mapping row ${byKey.get(key)!.row}` });
    else byKey.set(key, m);
  }

  const used = new Set<string>();
  const groups = new Map<string, Array<{ item: PlannedItem; map: ItemMapping; location: string }>>();
  const workbookKey = numbered();
  for (const item of analysis.items) {
    const key = workbookKey(item);
    const map = byKey.get(key);
    if (!map) {
      problems.push({ code: 'UNMAPPED_ITEM', category: item.category, sheet: item.sheet, row: item.row, productId: item.oldProductId, name: item.name, detail: `Location "${item.location ?? NO_LOCATION}" — add a row for it to the mapping file` });
      continue;
    }
    used.add(key);
    let ok = true;
    if (!map.sku) { problems.push({ code: 'MAPPING_ROW_INVALID', ...at(map), detail: 'No New SKU' }); ok = false; }
    else if (!SKU_PATTERN.test(map.sku)) { problems.push({ code: 'MAPPING_ROW_INVALID', ...at(map), detail: `SKU "${map.sku}": use letters, digits and - . / _ only, at most 64` }); ok = false; }
    if (!map.unitOfMeasure) { problems.push({ code: 'MAPPING_ROW_INVALID', ...at(map), detail: 'No unit of measure' }); ok = false; }
    else if (map.unitOfMeasure.length > 32) { problems.push({ code: 'MAPPING_ROW_INVALID', ...at(map), detail: 'Unit of measure longer than 32 characters' }); ok = false; }
    if (map.serialNumber) {
      if (item.category !== 'TOOLS') { problems.push({ code: 'MAPPING_ROW_INVALID', ...at(map), detail: `Serial number "${map.serialNumber}": only tools have one` }); ok = false; }
      else if (map.serialNumber.length > 64) { problems.push({ code: 'MAPPING_ROW_INVALID', ...at(map), detail: 'Serial number longer than 64 characters' }); ok = false; }
      else if (item.quantity > 1) { problems.push({ code: 'MAPPING_ROW_INVALID', ...at(map), detail: `Serial number "${map.serialNumber}" on ${item.quantity} tools: a serial number is for one tool; clear it, or list each tool on its own row` }); ok = false; }
    }
    const location = platformLocationOf(item.location);
    if (!location) {
      const spelling = item.location ?? NO_LOCATION;
      if (!reportedSpellings.has(spelling)) {
        reportedSpellings.add(spelling);
        problems.push({
          code: 'UNMAPPED_LOCATION', category: item.category, sheet: item.sheet, row: item.row, productId: item.oldProductId, name: item.name,
          detail: `"${spelling}" has no platform location in the Locations sheet`,
        });
      }
      ok = false;
    }
    if (!ok) continue;
    const sku = map.sku!.toUpperCase();
    groups.set(sku, [...(groups.get(sku) ?? []), { item, map, location: location! }]);
  }
  for (const m of mapping.items) {
    if (!used.has(keyOf.get(m)!) && !problems.some((p) => p.code === 'MAPPING_ROW_INVALID' && p.row === m.row)) {
      problems.push({ code: 'UNUSED_MAPPING_ROW', ...at(m), detail: 'Not in the stock workbook any more; delete the row or check the workbook' });
    }
  }

  const materials: PlannedMaterial[] = [];
  for (const [sku, rows] of groups) {
    const first = rows[0]!;
    const categories = new Set(rows.map((r) => r.item.category));
    const units = new Set(rows.map((r) => r.map.unitOfMeasure!.toLowerCase()));
    const where = rows.map((r) => `${r.item.sheet} row ${r.item.row}`).join(', ');
    if (categories.size > 1) {
      problems.push({ code: 'SKU_CONFLICT', productId: sku, detail: `${sku} is used in ${[...categories].map((c) => CATEGORY_LABEL[c]).join(' and ')} (${where})` });
      continue;
    }
    if (units.size > 1) {
      problems.push({ code: 'SKU_CONFLICT', productId: sku, detail: `${sku} has different units: ${[...units].join(', ')} (${where})` });
      continue;
    }
    const perLocation = new Map<string, number>();
    for (const r of rows) perLocation.set(r.location, (perLocation.get(r.location) ?? 0) + 1);
    const twice = [...perLocation].filter(([, n]) => n > 1).map(([l]) => l);
    if (twice.length > 0) {
      problems.push({ code: 'SKU_CONFLICT', productId: sku, detail: `${sku} is on two rows for ${twice.join(', ')}; merge them in the workbook (${where})` });
      continue;
    }
    if (new Set(rows.map((r) => nameKey(r.item.name))).size > 1) {
      problems.push({ code: 'SKU_JOINS_DIFFERENT_NAMES', productId: sku, name: first.item.name, detail: `${sku} joins ${rows.map((r) => `"${r.item.name}"`).join(', ')}; the first name is used` });
    }
    const serials = [...new Set(rows.map((r) => r.map.serialNumber).filter((x): x is string => !!x))];
    if (serials.length > 1 || (serials.length === 1 && rows.reduce((a, r) => a + r.item.quantity, 0) > 1)) {
      problems.push({ code: 'SKU_CONFLICT', productId: sku, detail: `${sku} joins rows with a serial number (${serials.join(', ')}); a serial number is for one tool (${where})` });
      continue;
    }
    const prices = [...new Set(rows.map((r) => r.item.unitPrice).filter((p): p is number => p !== null))];
    if (prices.length > 1) {
      problems.push({ code: 'SKU_JOINS_DIFFERENT_NAMES', productId: sku, name: first.item.name, detail: `${sku} joins rows with prices ${prices.map((p) => `R${p}`).join(', ')}; R${prices[0]} is used` });
    }
    materials.push({
      sku,
      name: first.item.name,
      category: first.item.category,
      unitOfMeasure: first.map.unitOfMeasure!,
      requiredStock: rows.reduce((a, r) => a + r.item.requiredStock, 0),
      unitCost: prices[0] ?? null,
      serialNumber: serials[0] ?? null,
      oldProductIds: [...new Set(rows.map((r) => r.item.oldProductId).filter((x): x is string => !!x))],
      balances: rows.map((r) => ({ location: r.location, quantity: r.item.quantity })),
    });
  }

  const usedLocations = new Set(materials.flatMap((m) => m.balances.map((b) => b.location)));
  const planned = new Map<string, PlannedLocation>();
  for (const name of usedLocations) {
    if (!typeByPlatform.has(name)) continue;
    const room = roomOf.get(name)?.room;
    planned.set(name, { name, type: typeByPlatform.get(name)!, ...(room ? { parent: room } : {}) });
    // A room that holds no stock of its own is still created, to hold its racks.
    if (room && !planned.has(room) && !usedLocations.has(room)) planned.set(room, { name: room, type: typeByPlatform.get(room) ?? 'STOREROOM' });
  }
  for (const l of planned.values()) {
    if (l.type === 'RACK' && !l.parent) problems.push({ code: 'RACK_WITHOUT_ROOM', sheet: loc, detail: `"${l.name}" has no Located in` });
  }
  // Rooms first, so each exists before the locations inside it.
  const plannedLocations = [...planned.values()].sort((a, b) => Number(!!a.parent) - Number(!!b.parent) || a.name.localeCompare(b.name));

  // No two items with one serial number.
  const bySerial = new Map<string, string[]>();
  for (const m of materials) if (m.serialNumber) bySerial.set(m.serialNumber.toLowerCase(), [...(bySerial.get(m.serialNumber.toLowerCase()) ?? []), m.sku]);
  const sharing = new Set<string>();
  for (const [serial, skus] of bySerial) {
    if (skus.length < 2) continue;
    problems.push({ code: 'SKU_CONFLICT', productId: skus[0], detail: `Serial number "${serial}" is given to ${skus.join(', ')}; each tool has its own` });
    skus.forEach((x) => sharing.add(x));
  }
  if (sharing.size > 0) materials.splice(0, materials.length, ...materials.filter((m) => !sharing.has(m.sku)));

  materials.sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
  return { materials, locations: plannedLocations, problems };
}
