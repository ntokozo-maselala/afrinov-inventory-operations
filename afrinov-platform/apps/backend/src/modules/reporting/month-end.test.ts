// Month-end report: the month rules and the workbook-layout Excel file. The
// as-at-month-end ledger query is covered against a real database.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { monthRange, type MonthEndReport } from './month-end.service.js';
import { buildMonthEndXlsx, monthEndFilename } from './month-end-export.js';

describe('month range', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  it('covers the whole month, ending at midnight on the 1st of the next', () => {
    expect(monthRange('2026-02', now)).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2026-09', now).end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(monthRange('2026-10', now).to).toBe('2026-10-31');
  });

  it.each([['2026-11', /not started/], ['2026-13', /YYYY-MM/], ['10/2026', /YYYY-MM/]])('refuses %s', (month, message) => {
    expect(() => monthRange(month, now)).toThrow(message);
  });
});

const REPORT: MonthEndReport = {
  month: '2026-09',
  from: '2026-09-01',
  to: '2026-09-30',
  generatedAt: '2026-10-09T10:00:00.000Z',
  currency: 'ZAR',
  bands: { urgentBelowPercent: 20, warningBelowPercent: 40 },
  categories: [
    {
      category: 'CONSUMABLES',
      items: [
        { sku: 'CON-0001', name: 'E115-7 PSF Grinding Disc', location: 'A-1', requiredStock: 100, currentStock: 11, unitCost: 42.05, value: 462.55, percentOfRequired: 0.11, reorderQuantity: 89, status: 'URGENT' },
        { sku: 'CON-0002', name: 'EHT115-1.0 Cutting Disc', location: 'A-1 (100), B-2 (67)', requiredStock: 100, currentStock: 167, unitCost: 30.1, value: 5026.7, percentOfRequired: 1.67, reorderQuantity: -67, status: 'OK' },
        { sku: 'CON-0003', name: 'Boiler chalk', location: '', requiredStock: 0, currentStock: 0, unitCost: null, value: null, percentOfRequired: null, reorderQuantity: null, status: 'NOT_SET' },
      ],
      value: 5489.25,
      urgent: 1,
      warning: 0,
      itemsInStock: 2,
      used: [{ sku: 'CON-0001', name: 'E115-7 PSF Grinding Disc', location: 'A-1', used: 25, value: 1051.25 }],
      usedValue: 1051.25,
    },
    {
      category: 'TOOLS', items: [], value: 0, urgent: 0, warning: 0, itemsInStock: 0, used: [], usedValue: 0,
    },
  ],
  total: { items: 3, itemsInStock: 2, value: 5489.25, urgent: 1, warning: 0, usedValue: 1051.25 },
};

async function load(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildMonthEndXlsx(REPORT)) as unknown as ExcelJS.Buffer);
  return wb;
}
const rows = (ws: ExcelJS.Worksheet, from = 1) => {
  const out: unknown[][] = [];
  ws.eachRow((r, n) => { if (n >= from) out.push((r.values as unknown[]).slice(1)); });
  return out;
};

describe('month-end workbook', () => {
  it('opens with an overview per category', async () => {
    const wb = await load();
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Overview', 'Stock Summary', 'Consumables Used', 'Tools Summary', 'Tools Used']);
    const t = rows(wb.getWorksheet('Overview')!, 4);
    expect(t[0]).toEqual(['Category', 'Items', 'In stock', 'Stock value (ZAR)', 'Urgent', 'Warning', 'Used in month (ZAR)']);
    expect(t[1]).toEqual(['Consumables', 3, 2, 5489.25, 1, 0, 1051.25]);
    expect(t[3]).toEqual(['Total', 3, 2, 5489.25, 1, 0, 1051.25]);
    expect(String(wb.getWorksheet('Overview')!.getCell('A2').value)).toContain('as at the end of 30 September 2026');
  });

  it('has a Summary sheet per category in the workbook columns, total above the table', async () => {
    const ws = (await load()).getWorksheet('Stock Summary')!;
    expect(ws.getCell('B2').value).toBe(5489.25);
    expect(String(ws.getCell('B3').value)).toMatch(/^STOCK INVENTORY/);
    const t = rows(ws, 4);
    expect(t[0]).toEqual(['S.N #:', 'Product ID', 'Item Name', 'Location', 'Required Stock', 'Current Stock', 'Stock Value VAT Exl',
      '% In Stock Re-Up', 'Unit Price Ex VAT', 'Re Order IN QTY', 'URGENCY']);
    expect(t[1]).toEqual([1, 'CON-0001', 'E115-7 PSF Grinding Disc', 'A-1', 100, 11, 462.55, 0.11, 42.05, 89, 'URGENT']);
    // Over the required level, Re Order IN QTY goes negative, as in the workbook.
    expect(t[2]!.slice(8)).toEqual([30.1, -67, 'OK']);
    expect(t[3]).toEqual([3, 'CON-0003', 'Boiler chalk', '', 0, 0, undefined, undefined, undefined, undefined, 'NOT SET']);
    expect(ws.getRow(5).getCell(8).numFmt).toBe('0%');
  });

  it('has a Used sheet per category in the Stock Report layout', async () => {
    const ws = (await load()).getWorksheet('Consumables Used')!;
    expect(ws.getCell('A3').value).toBe(1051.25);
    expect(String(ws.getCell('A4').value)).toBe('Used Stock Inventory — 2026-09-01 to 2026-09-30');
    const t = rows(ws, 5);
    expect(t[0]).toEqual(['Product ID', 'Item Name', 'Rack', 'Stock Used In QTY', 'Stock In Value Ex VAT']);
    expect(t[1]).toEqual(['CON-0001', 'E115-7 PSF Grinding Disc', 'A-1', 25, 1051.25]);
    expect(rows((await load()).getWorksheet('Tools Used')!, 6)[0]).toEqual(['', 'Nothing was used in this month.']);
  });

  it('names the file by month', () => {
    expect(monthEndFilename('2026-09')).toBe('afrinov-month-end-2026-09.xlsx');
  });
});
