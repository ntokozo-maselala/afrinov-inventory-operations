// Checks the workbook rows before anything is imported, and says what the
// import would load: one item per Main row, with its opening quantity and the
// unit price matched from the Summary sheet. Every doubt becomes a problem in
// the dry-run report; nothing is fixed silently.
//
//  - error:  the import cannot load the row as it stands.
//  - review: the import can load it with a default, but someone should check.
import type { MaterialCategory } from '@prisma/client';
import { CATEGORY_SHEETS, type MainRow, type SummaryRow, type WorkbookRead } from './workbook-reader.js';

export type ProblemCode =
  | 'MISSING_SHEET'
  | 'MISSING_NAME'
  | 'NOT_A_NUMBER'
  | 'DUPLICATE_ROW'
  | 'MISSING_PRODUCT_ID'
  | 'DUPLICATE_PRODUCT_ID'
  | 'PRODUCT_ID_IN_SEVERAL_CATEGORIES'
  | 'NAME_IN_SEVERAL_CATEGORIES'
  | 'NEGATIVE_STOCK'
  | 'STOCK_MISMATCH'
  | 'REQUIRED_STOCK_BLANK'
  | 'MISSING_UNIT_PRICE'
  | 'PRICE_CONFLICT'
  | 'BLANK_LOCATION'
  | 'LOCATION_SPELLINGS'
  // Mapping file checks (see mapping.ts).
  | 'MAPPING_SHEET_MISSING'
  | 'MAPPING_ROW_INVALID'
  | 'UNMAPPED_ITEM'
  | 'UNMAPPED_LOCATION'
  | 'MAPPING_LOCATION_INVALID'
  | 'SKU_CONFLICT'
  | 'UNUSED_MAPPING_ROW'
  | 'SKU_JOINS_DIFFERENT_NAMES';

export const PROBLEM_TEXT: Record<ProblemCode, { severity: 'error' | 'review'; title: string; resolution: string }> = {
  MISSING_SHEET: { severity: 'error', title: 'Sheet not found', resolution: 'Use the right workbook, or check the sheet was not renamed.' },
  MISSING_NAME: { severity: 'error', title: 'Row has stock but no item name', resolution: 'Name the item or clear the row in the workbook.' },
  NOT_A_NUMBER: { severity: 'error', title: 'Text where a number should be', resolution: 'Correct the cell in the workbook.' },
  DUPLICATE_ROW: { severity: 'error', title: 'Same item and location on two rows', resolution: 'Merge the rows; otherwise the stock would be counted twice.' },
  MISSING_PRODUCT_ID: { severity: 'review', title: 'No Product ID', resolution: 'A new SKU is assigned; nothing to do unless the ID is known.' },
  DUPLICATE_PRODUCT_ID: { severity: 'review', title: 'Product ID used for different items', resolution: 'Each item gets its own new SKU; the old ID is kept for reference only.' },
  PRODUCT_ID_IN_SEVERAL_CATEGORIES: { severity: 'review', title: 'Product ID used in more than one category', resolution: 'Each item gets its own new SKU; the old ID is kept for reference only.' },
  NAME_IN_SEVERAL_CATEGORIES: { severity: 'review', title: 'Same item name in more than one category', resolution: 'The store decides which category owns the item.' },
  NEGATIVE_STOCK: { severity: 'review', title: 'Negative stock', resolution: 'Imported as 0; the go-live count sets the real quantity.' },
  STOCK_MISMATCH: { severity: 'review', title: 'Current Stock is not Brought Forward + IN - OUT', resolution: 'Current Stock is used; check the row.' },
  REQUIRED_STOCK_BLANK: { severity: 'review', title: 'Required Stock blank', resolution: 'Imported as 0; the store fills in the top movers first.' },
  MISSING_UNIT_PRICE: { severity: 'review', title: 'No unit price', resolution: 'Imported with no price; the buyer supplies it.' },
  PRICE_CONFLICT: { severity: 'review', title: 'Different prices for the same item', resolution: 'The price on the row with the same Product ID and location is used; the buyer confirms.' },
  BLANK_LOCATION: { severity: 'review', title: 'No location', resolution: 'Choose the location in the mapping file.' },
  LOCATION_SPELLINGS: { severity: 'review', title: 'One location spelt several ways', resolution: 'Map every spelling to one location in the mapping file.' },
  MAPPING_SHEET_MISSING: { severity: 'error', title: 'Mapping file sheet missing', resolution: 'Delete the mapping file and run the dry run again to get a fresh one.' },
  MAPPING_ROW_INVALID: { severity: 'error', title: 'Mapping row incomplete or wrong', resolution: 'Correct the row in the mapping file.' },
  UNMAPPED_ITEM: { severity: 'error', title: 'Workbook row not in the mapping file', resolution: 'Add a row for it on the Items sheet, copying the grey columns exactly.' },
  UNMAPPED_LOCATION: { severity: 'error', title: 'Location with no platform location', resolution: 'On the Locations sheet, fill in its platform location and type (add the row if it is missing).' },
  MAPPING_LOCATION_INVALID: { severity: 'error', title: 'Location type missing or wrong', resolution: 'Choose a type from the list on the Locations sheet.' },
  SKU_CONFLICT: { severity: 'error', title: 'SKU given to rows that cannot be one item', resolution: 'Give the rows different SKUs, or fix the category, unit or duplicate row.' },
  UNUSED_MAPPING_ROW: { severity: 'review', title: 'Mapping row with no workbook row', resolution: 'Delete the row from the mapping file if the workbook row was merged or removed.' },
  SKU_JOINS_DIFFERENT_NAMES: { severity: 'review', title: 'One SKU joins different names or prices', resolution: 'Check these really are the same item.' },
};

/** Workbook problems a mapping file settles: new SKUs replace the old IDs, and spellings are mapped. */
export const RESOLVED_BY_MAPPING: ReadonlySet<ProblemCode> = new Set<ProblemCode>([
  'MISSING_PRODUCT_ID', 'DUPLICATE_PRODUCT_ID', 'PRODUCT_ID_IN_SEVERAL_CATEGORIES', 'BLANK_LOCATION', 'LOCATION_SPELLINGS',
]);

export interface Problem {
  code: ProblemCode;
  category?: MaterialCategory;
  sheet?: string;
  row?: number;
  productId?: string | null;
  name?: string | null;
  detail: string;
}

export interface PlannedItem {
  category: MaterialCategory;
  sheet: string;
  row: number;
  oldProductId: string | null;
  name: string;
  location: string | null;
  /** Opening quantity: Current Stock, never below zero. */
  quantity: number;
  requiredStock: number;
  unitPrice: number | null;
}

export interface CategoryTotals {
  category: MaterialCategory;
  rows: number;
  quantity: number;
  /** Rand value excl. VAT of the planned items: quantity x unit price. */
  value: number;
  /** The total the workbook's Summary sheet shows at the top. */
  workbookTotal: number | null;
  /** The Summary sheet's Stock Value column added up over every item row. */
  workbookRowsTotal: number | null;
}

export interface LocationSpelling { key: string; spellings: Array<{ text: string; rows: number }> }

export interface Analysis {
  items: PlannedItem[];
  problems: Problem[];
  categories: CategoryTotals[];
  /** Every location as written, grouped where only case, spaces or punctuation differ. */
  locations: LocationSpelling[];
  /** Rows with a Product ID filled in ahead of time but no item and no stock. */
  unusedRows: number;
}

export const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  CONSUMABLES: 'Consumables',
  FASTENERS_SLUGS_INSULATION: 'Fasteners, Slugs & Insulation',
  TOOLING_PPE_ELECTRICAL: 'Tooling, PPE & Electrical',
  PROJECT_MATERIAL: 'Project Material',
  TOOLS: 'Tools',
};
const labels = (cs: Iterable<MaterialCategory>) => [...cs].map((c) => CATEGORY_LABEL[c]).join(', ');

const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** Ignores case, spaces and punctuation: "Stores (b1)" and "stores(B1)" are one location. */
export const locationKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const round2 = (n: number) => Math.round(n * 100) / 100;

function where(r: MainRow | SummaryRow): Pick<Problem, 'category' | 'sheet' | 'row' | 'productId' | 'name'> {
  return { category: r.category, sheet: r.sheet, row: r.row, productId: r.productId, name: r.name };
}

function matchPrice(row: MainRow, summaries: SummaryRow[], problems: Problem[]): number | null {
  if (!row.name) return null;
  const sameName = summaries.filter((s) => s.category === row.category && s.name && nameKey(s.name) === nameKey(row.name!));
  const priced = sameName.filter((s) => s.unitPrice.value !== null);
  if (priced.length === 0) return null;
  const prices = [...new Set(priced.map((s) => s.unitPrice.value!))];
  // Best match first: same Product ID and location, then same Product ID, then name alone.
  const best = priced.find((s) => s.productId === row.productId && s.location === row.location)
    ?? priced.find((s) => s.productId === row.productId)
    ?? priced[0]!;
  if (prices.length > 1) {
    problems.push({ code: 'PRICE_CONFLICT', ...where(row), detail: `Prices found: ${prices.map((p) => `R${p}`).join(', ')}; using R${best.unitPrice.value}` });
  }
  return best.unitPrice.value;
}

export function analyseWorkbook(read: WorkbookRead): Analysis {
  const problems: Problem[] = [];
  const items: PlannedItem[] = [];
  let unusedRows = 0;

  for (const sheet of read.missingSheets) problems.push({ code: 'MISSING_SHEET', sheet, detail: `"${sheet}" is not in the workbook` });

  for (const row of read.mainRows) {
    if (!row.name) {
      const hasStock = [row.broughtForward, row.currentStock, row.in, row.out]
        .some((n) => (n.value !== null && n.value !== 0) || n.raw !== undefined);
      if (hasStock) problems.push({ code: 'MISSING_NAME', ...where(row), detail: `Current Stock ${row.currentStock.value ?? row.currentStock.raw ?? 'blank'}` });
      else unusedRows++;
      continue;
    }
    if (!row.productId) problems.push({ code: 'MISSING_PRODUCT_ID', ...where(row), detail: 'New SKU assigned' });
    if (!row.location) problems.push({ code: 'BLANK_LOCATION', ...where(row), detail: 'No location on the row' });

    const bad = (['broughtForward', 'currentStock', 'in', 'out', 'requiredStock'] as const)
      .filter((k) => row[k].raw !== undefined)
      .map((k) => `${k} "${row[k].raw}"`);
    if (bad.length > 0) problems.push({ code: 'NOT_A_NUMBER', ...where(row), detail: bad.join(', ') });

    const computed = row.broughtForward.value === null ? null
      : row.broughtForward.value + (row.in.value ?? 0) - (row.out.value ?? 0);
    const current = row.currentStock.value ?? computed ?? 0;
    if (row.currentStock.value !== null && computed !== null && Math.abs(row.currentStock.value - computed) > 1e-9) {
      problems.push({ code: 'STOCK_MISMATCH', ...where(row), detail: `Current Stock ${row.currentStock.value}, Brought Forward + IN - OUT = ${computed}` });
    }
    if (current < 0) problems.push({ code: 'NEGATIVE_STOCK', ...where(row), detail: `Current Stock ${current}` });
    if (row.requiredStock.value === null && row.requiredStock.raw === undefined) {
      problems.push({ code: 'REQUIRED_STOCK_BLANK', ...where(row), detail: 'Imported as 0' });
    }

    const unitPrice = matchPrice(row, read.summaryRows, problems);
    if (unitPrice === null) problems.push({ code: 'MISSING_UNIT_PRICE', ...where(row), detail: 'No price on the Summary sheet for this item' });

    items.push({
      category: row.category,
      sheet: row.sheet,
      row: row.row,
      oldProductId: row.productId,
      name: row.name,
      location: row.location,
      quantity: Math.max(0, current),
      requiredStock: row.requiredStock.value ?? 0,
      unitPrice,
    });
  }

  // Same item and location twice in a category.
  const seenRow = new Map<string, PlannedItem>();
  for (const item of items) {
    const key = `${item.category}|${nameKey(item.name)}|${locationKey(item.location ?? '')}`;
    const first = seenRow.get(key);
    if (first) {
      problems.push({ code: 'DUPLICATE_ROW', category: item.category, sheet: item.sheet, row: item.row, productId: item.oldProductId, name: item.name, detail: `Also on row ${first.row}` });
    } else {
      seenRow.set(key, item);
    }
  }

  // One Product ID used for different items in a category, or across categories.
  const byId = new Map<string, PlannedItem[]>();
  for (const item of items) if (item.oldProductId) byId.set(item.oldProductId, [...(byId.get(item.oldProductId) ?? []), item]);
  for (const [id, group] of byId) {
    const categories = new Set(group.map((i) => i.category));
    for (const category of categories) {
      const inCategory = group.filter((i) => i.category === category);
      if (new Set(inCategory.map((i) => nameKey(i.name))).size > 1) {
        for (const i of inCategory) {
          problems.push({ code: 'DUPLICATE_PRODUCT_ID', category, sheet: i.sheet, row: i.row, productId: id, name: i.name, detail: `${id} is used for ${inCategory.length} rows` });
        }
      }
    }
    if (categories.size > 1) {
      problems.push({ code: 'PRODUCT_ID_IN_SEVERAL_CATEGORIES', productId: id, detail: `${id} appears in ${labels(categories)}` });
    }
  }

  // The same item name in more than one category.
  const byName = new Map<string, PlannedItem[]>();
  for (const item of items) byName.set(nameKey(item.name), [...(byName.get(nameKey(item.name)) ?? []), item]);
  for (const group of byName.values()) {
    const categories = [...new Set(group.map((i) => i.category))];
    if (categories.length > 1) {
      problems.push({ code: 'NAME_IN_SEVERAL_CATEGORIES', name: group[0]!.name, detail: `In ${labels(categories)}` });
    }
  }

  // Location spellings.
  const spellings = new Map<string, Map<string, number>>();
  for (const item of items) {
    if (!item.location) continue;
    const key = locationKey(item.location);
    const m = spellings.get(key) ?? new Map<string, number>();
    m.set(item.location, (m.get(item.location) ?? 0) + 1);
    spellings.set(key, m);
  }
  const locations: LocationSpelling[] = [...spellings]
    .map(([key, m]) => ({ key, spellings: [...m].map(([text, rows]) => ({ text, rows })).sort((a, b) => b.rows - a.rows) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  for (const loc of locations) {
    if (loc.spellings.length > 1) {
      problems.push({ code: 'LOCATION_SPELLINGS', detail: loc.spellings.map((s) => `"${s.text}" (${s.rows})`).join(', ') });
    }
  }

  const categories: CategoryTotals[] = CATEGORY_SHEETS.map(({ category }) => {
    const mine = items.filter((i) => i.category === category);
    return {
      category,
      rows: mine.length,
      quantity: round2(mine.reduce((a, i) => a + i.quantity, 0)),
      value: round2(mine.reduce((a, i) => a + i.quantity * (i.unitPrice ?? 0), 0)),
      workbookTotal: read.summaryTotals[category] === undefined ? null : round2(read.summaryTotals[category]!),
      workbookRowsTotal: read.summaryRowTotals[category] === undefined ? null : round2(read.summaryRowTotals[category]!),
    };
  });

  return { items, problems, categories, locations, unusedRows };
}
