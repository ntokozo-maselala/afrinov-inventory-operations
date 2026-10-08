// The workbook dry run, on a small made-up workbook laid out like the real
// one (the real workbook holds business data and never enters the repo).
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readWorkbookSheets, numberOf, shownValue } from './workbook-reader.js';
import { analyseWorkbook, locationKey, type Analysis, type ProblemCode } from './workbook-analysis.js';
import { renderReport } from './workbook-report.js';

type Row = Array<ExcelJS.CellValue>;

const MAIN_HEADER: Row = ['Product ID', 'Item Name', 'Location', 'Brought Forward', 'Current Stock', 'IN', 'OUT', 'Column1', 'Required Stock'];
const SUMMARY_HEADER: Row = ['S.N #:', 'Product ID', 'Item Name', 'Location', 'Required Stock', 'Current Stock', 'Stock Value VAT Exl', '% In Stock Re-Up', 'Unit Price Ex VAT'];

/** Current Stock as the workbook stores it: a formula with its saved result. */
const stock = (result: number): ExcelJS.CellValue => ({ formula: 'D2+F2-G2', result } as ExcelJS.CellFormulaValue);

function addMain(wb: ExcelJS.Workbook, name: string, rows: Row[], headerAt = 1) {
  const ws = wb.addWorksheet(name);
  if (headerAt === 2) {
    // The Fasteners layout: "Required Stock" sits one row above the other titles.
    ws.addRow([null, null, null, null, null, null, null, null, 'Required Stock']);
    ws.addRow(MAIN_HEADER.slice(0, 8));
  } else {
    ws.addRow(MAIN_HEADER);
  }
  rows.forEach((r) => ws.addRow(r));
}

function addSummary(wb: ExcelJS.Workbook, name: string, total: number, rows: Row[]) {
  const ws = wb.addWorksheet(name);
  ws.addRow([]);
  ws.addRow([null, { formula: 'SUM(G5:G6)', result: total } as ExcelJS.CellFormulaValue]);
  ws.addRow([null, 'STOCK INVENTORY']);
  ws.addRow(SUMMARY_HEADER);
  rows.forEach((r) => ws.addRow(r));
}

async function sampleWorkbook(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  addMain(wb, 'Consumables Main', [
    ['P-001', 'Grinding disc', 'A-1', 10, stock(11), 1, 0, null, 100],
    ['P-002', '  Cutting   disc ', 'Store room', 5, stock(5), 0, 0, null, null],
    ['P-002', 'Flap disc', 'STORE ROOM', 2, stock(2), 0, 0, null, 10],
    ['P-003', 'Bucket', 'A-1', 3, stock(3), 0, 0, null, 5],
    ['P-004', 'Bucket', 'a-1', 1, stock(1), 0, 0, null, 5],
    ['P-099', null, null, 0, stock(0), 0, 0, null, null],
  ]);
  addSummary(wb, 'Stock Summary', 100, [
    [null, 'P-001', 'Grinding disc', 'A-1', 100, 11, 110, null, 10],
    [null, 'P-002', 'Cutting disc', 'Store room', null, 5, 50, null, 10],
    [null, 'P-002', 'Flap disc', 'STORE ROOM', 10, 2, null, null, null],
    [null, 'P-003', 'Bucket', 'A-1', 5, 3, 30, null, 10],
    [null, 'P-004', 'Bucket', 'a-1', 5, 1, 12, null, 12],
  ]);
  addMain(wb, 'Fasteners, Slugs & Insluation M', [
    ['P-001', 'Slugs 14mm', 'D-1', 6, stock(-2), 0, 8, null, 3],
    [null, 'Drill 6mm', 'D-1', 4, stock(4), 0, 0, null, 1],
    ['P-500', null, 'D-1', 3, stock(3), 0, 0, null, null],
  ], 2);
  addSummary(wb, 'FS&I Stock Summary', 0, [
    [null, 'P-001', 'Slugs 14mm', 'D-1', 3, -2, -50, null, 25],
    [null, null, 'Drill 6mm', 'D-1', 1, 4, 40, null, 10],
  ]);
  addMain(wb, 'Tooling, PPE & Electrical Main', [
    ['P-700', 'Drill 6mm', 'E-2', 1, stock(2), 0, 0, null, 1],
  ]);
  addSummary(wb, 'TP&E Stock Summary', 0, [[null, 'P-700', 'Drill 6mm', 'E-2', 1, 2, 20, null, 10]]);
  // Project Material sheets left out on purpose.
  return wb;
}

async function analyse(): Promise<Analysis> {
  // Round-trip through a file buffer, as the real import reads from disk.
  const wb = await sampleWorkbook();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await wb.xlsx.writeBuffer());
  return analyseWorkbook(readWorkbookSheets(loaded));
}

const codes = (a: Analysis, code: ProblemCode) => a.problems.filter((p) => p.code === code);

describe('workbook reader', () => {
  it('shows formula results, joins rich text and treats errors as blank', () => {
    expect(shownValue({ formula: 'A1', result: 7 } as ExcelJS.CellFormulaValue)).toBe(7);
    expect(shownValue({ sharedFormula: 'E2', result: 3 } as ExcelJS.CellSharedFormulaValue)).toBe(3);
    expect(shownValue({ formula: 'SUMIFS(...)' } as ExcelJS.CellFormulaValue)).toBeNull();
    expect(shownValue({ richText: [{ text: 'Cut' }, { text: 'ter' }] })).toBe('Cutter');
    expect(shownValue({ error: '#REF!' } as ExcelJS.CellErrorValue)).toBeNull();
  });

  it('reads numbers typed as text and keeps text that is not a number', () => {
    expect(numberOf('1,250')).toEqual({ value: 1250 });
    expect(numberOf('  ')).toEqual({ value: null });
    expect(numberOf('ten')).toEqual({ value: null, raw: 'ten' });
  });

  it('finds the header wherever it sits, including Required Stock one row up', async () => {
    const a = await analyse();
    expect(a.items.find((i) => i.name === 'Slugs 14mm')).toMatchObject({ requiredStock: 3, sheet: 'Fasteners, Slugs & Insluation M', row: 3 });
    expect(a.items.find((i) => i.name === 'Grinding disc')).toMatchObject({ quantity: 11, requiredStock: 100, row: 2 });
  });
});

describe('workbook analysis', () => {
  it('plans one item per named row and skips rows with only a Product ID', async () => {
    const a = await analyse();
    expect(a.items).toHaveLength(8);
    expect(a.unusedRows).toBe(1);
    expect(a.items.find((i) => i.oldProductId === 'P-002' && i.location === 'Store room')?.name).toBe('Cutting disc');
  });

  it('blocks a nameless row that holds stock', async () => {
    const a = await analyse();
    expect(codes(a, 'MISSING_NAME')).toEqual([expect.objectContaining({ productId: 'P-500', row: 5, detail: 'Current Stock 3' })]);
  });

  it('flags the same item and location twice, ignoring case and spacing in the location', async () => {
    const a = await analyse();
    expect(codes(a, 'DUPLICATE_ROW')).toEqual([expect.objectContaining({ name: 'Bucket', row: 6, detail: 'Also on row 5' })]);
  });

  it('flags Product IDs reused for different items and across categories', async () => {
    const a = await analyse();
    expect(codes(a, 'DUPLICATE_PRODUCT_ID').map((p) => p.row)).toEqual([3, 4]);
    expect(codes(a, 'PRODUCT_ID_IN_SEVERAL_CATEGORIES')).toEqual([
      expect.objectContaining({ productId: 'P-001', detail: 'P-001 appears in Consumables, Fasteners, Slugs & Insulation' }),
    ]);
    expect(codes(a, 'MISSING_PRODUCT_ID')).toEqual([expect.objectContaining({ name: 'Drill 6mm', category: 'FASTENERS_SLUGS_INSULATION' })]);
    expect(codes(a, 'NAME_IN_SEVERAL_CATEGORIES')).toEqual([expect.objectContaining({ name: 'Drill 6mm' })]);
  });

  it('imports negative stock as zero and flags it', async () => {
    const a = await analyse();
    expect(a.items.find((i) => i.name === 'Slugs 14mm')?.quantity).toBe(0);
    expect(codes(a, 'NEGATIVE_STOCK')).toEqual([expect.objectContaining({ name: 'Slugs 14mm', detail: 'Current Stock -2' })]);
  });

  it('checks Current Stock against Brought Forward + IN - OUT', async () => {
    const a = await analyse();
    // Grinding disc: 10 + 1 - 0 = 11 (fine). Tooling drill: 1 + 0 - 0 = 1, but shows 2.
    expect(codes(a, 'STOCK_MISMATCH')).toEqual([expect.objectContaining({ name: 'Drill 6mm', category: 'TOOLING_PPE_ELECTRICAL' })]);
  });

  it('takes the price by item name, preferring the row with the same Product ID and location', async () => {
    const a = await analyse();
    const buckets = a.items.filter((i) => i.name === 'Bucket');
    expect(buckets.map((b) => b.unitPrice)).toEqual([10, 12]);
    expect(codes(a, 'PRICE_CONFLICT')).toHaveLength(2);
    expect(a.items.find((i) => i.name === 'Cutting disc')?.unitPrice).toBe(10);
    expect(codes(a, 'MISSING_UNIT_PRICE')).toEqual([expect.objectContaining({ name: 'Flap disc' })]);
  });

  it('lists blank Required Stock and groups location spellings', async () => {
    const a = await analyse();
    expect(codes(a, 'REQUIRED_STOCK_BLANK').map((p) => p.name)).toEqual(['Cutting disc']);
    expect(a.locations.find((l) => l.key === locationKey('Store room'))?.spellings).toEqual([
      { text: 'Store room', rows: 1 }, { text: 'STORE ROOM', rows: 1 },
    ]);
    expect(codes(a, 'LOCATION_SPELLINGS')).toHaveLength(2);
  });

  it('reports the missing Project Material sheets', async () => {
    const a = await analyse();
    expect(codes(a, 'MISSING_SHEET').map((p) => p.sheet)).toEqual(['Project Material Main', 'Project Stock Summary']);
  });

  it('totals value per category and keeps both workbook totals', async () => {
    const a = await analyse();
    expect(a.categories.find((c) => c.category === 'CONSUMABLES')).toEqual({
      category: 'CONSUMABLES', rows: 5, quantity: 22, value: 11 * 10 + 5 * 10 + 3 * 10 + 1 * 12,
      workbookTotal: 100, workbookRowsTotal: 110 + 50 + 30 + 12,
    });
    expect(a.categories.find((c) => c.category === 'PROJECT_MATERIAL')).toMatchObject({ rows: 0, workbookTotal: null });
  });
});

describe('dry-run report', () => {
  it('says what is blocking and lists each problem row', async () => {
    const report = renderReport(await analyse(), { file: 'sample.xlsm', generatedAt: new Date('2026-10-08T10:00:00Z') });
    expect(report).toContain('Nothing was written to the database.');
    expect(report).toMatch(/\*\*4 blocking problems\*\*/);
    expect(report).toContain('| Same item and location on two rows | **blocking** | 1 |');
    expect(report).toContain('| Consumables Main | 6 | P-004 | Bucket | Also on row 5 |');
    expect(report).toContain('1 unused rows');
  });
});
