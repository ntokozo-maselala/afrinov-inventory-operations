// Reads the stock workbook (AFRI-03A-08-IAM-02) that the platform replaces:
// the four Main sheets (one row per item and location, with Brought Forward,
// IN, OUT, Current Stock and Required Stock) and the four Summary sheets
// (which carry the unit price). Header rows are found by their titles, not by
// position, because the sheets do not agree on where the header sits.
//
// Nothing here writes anywhere; see workbook-analysis.ts for the checks.
import ExcelJS from 'exceljs';
import type { MaterialCategory } from '@prisma/client';

export interface CategorySheets {
  category: MaterialCategory;
  /** Prefix for the new SKUs, e.g. CON-0001. */
  skuPrefix: string;
  main: string;
  summary: string;
}

// Sheet names exactly as they appear in the workbook (the Fasteners Main name
// is cut short by Excel's 31-character limit).
export const CATEGORY_SHEETS: CategorySheets[] = [
  { category: 'CONSUMABLES', skuPrefix: 'CON', main: 'Consumables Main', summary: 'Stock Summary' },
  { category: 'FASTENERS_SLUGS_INSULATION', skuPrefix: 'FSI', main: 'Fasteners, Slugs & Insluation M', summary: 'FS&I Stock Summary' },
  { category: 'TOOLING_PPE_ELECTRICAL', skuPrefix: 'TPE', main: 'Tooling, PPE & Electrical Main', summary: 'TP&E Stock Summary' },
  { category: 'PROJECT_MATERIAL', skuPrefix: 'PRJ', main: 'Project Material Main', summary: 'Project Stock Summary' },
];

/** A cell as read: the shown value, or null when blank. `raw` keeps text that is not a number. */
export interface NumberCell { value: number | null; raw?: string }

export interface MainRow {
  category: MaterialCategory;
  sheet: string;
  /** 1-based row number in Excel, for the problem report. */
  row: number;
  productId: string | null;
  name: string | null;
  location: string | null;
  broughtForward: NumberCell;
  currentStock: NumberCell;
  in: NumberCell;
  out: NumberCell;
  requiredStock: NumberCell;
}

export interface SummaryRow {
  category: MaterialCategory;
  sheet: string;
  row: number;
  productId: string | null;
  name: string | null;
  location: string | null;
  unitPrice: NumberCell;
  stockValue: NumberCell;
}

export interface WorkbookRead {
  mainRows: MainRow[];
  summaryRows: SummaryRow[];
  /**
   * The total rand value each Summary sheet shows above its table, per category.
   * Its SUM range can stop short of the last row, so see summaryRowTotals too.
   */
  summaryTotals: Partial<Record<MaterialCategory, number>>;
  /** The Summary sheet's "Stock Value VAT Exl" column added up over every item row. */
  summaryRowTotals: Partial<Record<MaterialCategory, number>>;
  missingSheets: string[];
}

type CellValue = ExcelJS.CellValue;

/** The value Excel would show: formula results, rich text joined, errors as null. */
export function shownValue(v: CellValue): string | number | Date | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return shownValue((v as { result?: CellValue }).result ?? null);
    if ('formula' in v || 'sharedFormula' in v) return null;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text);
    if ('error' in v) return null;
  }
  return null;
}

export function textOf(v: CellValue): string | null {
  const s = shownValue(v);
  if (s === null) return null;
  const t = (s instanceof Date ? s.toISOString() : String(s)).replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

export function numberOf(v: CellValue): NumberCell {
  const s = shownValue(v);
  if (s === null) return { value: null };
  if (typeof s === 'number') return Number.isFinite(s) ? { value: s } : { value: null, raw: String(s) };
  const t = String(s).trim();
  if (t === '') return { value: null };
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? { value: n } : { value: null, raw: t };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Column numbers by header title. The header row is the first of the top ten
 * rows with a "Product ID" cell; a title missing there is taken from the row
 * above (the Fasteners Main sheet puts "Required Stock" one row higher).
 */
export function findHeader(ws: ExcelJS.Worksheet): { row: number; columns: Map<string, number> } | null {
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    let found = false;
    row.eachCell((cell) => { if (textOf(cell.value) && norm(textOf(cell.value)!) === 'product id') found = true; });
    if (!found) continue;
    const columns = new Map<string, number>();
    const take = (rr: number) => ws.getRow(rr).eachCell((cell, col) => {
      const t = textOf(cell.value);
      if (t && !columns.has(norm(t)) && ![...columns.values()].includes(col)) columns.set(norm(t), col);
    });
    take(r);
    if (r > 1) take(r - 1);
    return { row: r, columns };
  }
  return null;
}

function col(columns: Map<string, number>, title: string): number | undefined {
  return columns.get(norm(title));
}

function cellAt(row: ExcelJS.Row, column: number | undefined): CellValue {
  return column === undefined ? null : row.getCell(column).value;
}

function readMain(ws: ExcelJS.Worksheet, sheets: CategorySheets): MainRow[] {
  const header = findHeader(ws);
  if (!header) return [];
  const c = header.columns;
  const out: MainRow[] = [];
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const productId = textOf(cellAt(row, col(c, 'Product ID')));
    const name = textOf(cellAt(row, col(c, 'Item Name')));
    if (!productId && !name) continue;
    out.push({
      category: sheets.category,
      sheet: sheets.main,
      row: r,
      productId,
      name,
      location: textOf(cellAt(row, col(c, 'Location'))),
      broughtForward: numberOf(cellAt(row, col(c, 'Brought Forward'))),
      currentStock: numberOf(cellAt(row, col(c, 'Current Stock'))),
      in: numberOf(cellAt(row, col(c, 'IN'))),
      out: numberOf(cellAt(row, col(c, 'OUT'))),
      requiredStock: numberOf(cellAt(row, col(c, 'Required Stock'))),
    });
  }
  return out;
}

function readSummary(ws: ExcelJS.Worksheet, sheets: CategorySheets): { rows: SummaryRow[]; total: number | null } {
  const header = findHeader(ws);
  if (!header) return { rows: [], total: null };
  const c = header.columns;
  const productCol = col(c, 'Product ID');
  // The sheet total sits above the table, in the Product ID column.
  let total: number | null = null;
  for (let r = 1; r < header.row && productCol !== undefined; r++) {
    const n = numberOf(ws.getRow(r).getCell(productCol).value).value;
    if (n !== null) { total = n; break; }
  }
  const rows: SummaryRow[] = [];
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const productId = textOf(cellAt(row, productCol));
    const name = textOf(cellAt(row, col(c, 'Item Name')));
    if (!productId && !name) continue;
    rows.push({
      category: sheets.category,
      sheet: sheets.summary,
      row: r,
      productId,
      name,
      location: textOf(cellAt(row, col(c, 'Location'))),
      unitPrice: numberOf(cellAt(row, col(c, 'Unit Price Ex VAT'))),
      stockValue: numberOf(cellAt(row, col(c, 'Stock Value VAT Exl'))),
    });
  }
  return { rows, total };
}

export function readWorkbookSheets(wb: ExcelJS.Workbook): WorkbookRead {
  const result: WorkbookRead = { mainRows: [], summaryRows: [], summaryTotals: {}, summaryRowTotals: {}, missingSheets: [] };
  for (const sheets of CATEGORY_SHEETS) {
    const main = wb.getWorksheet(sheets.main);
    if (main) result.mainRows.push(...readMain(main, sheets));
    else result.missingSheets.push(sheets.main);
    const summary = wb.getWorksheet(sheets.summary);
    if (summary) {
      const { rows, total } = readSummary(summary, sheets);
      result.summaryRows.push(...rows);
      if (total !== null) result.summaryTotals[sheets.category] = total;
      result.summaryRowTotals[sheets.category] = rows
        .filter((r) => r.name)
        .reduce((a, r) => a + (r.stockValue.value ?? 0), 0);
    } else {
      result.missingSheets.push(sheets.summary);
    }
  }
  return result;
}

export async function readWorkbookFile(path: string): Promise<WorkbookRead> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return readWorkbookSheets(wb);
}
