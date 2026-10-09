// Consumption: the date range rules and the Excel file. The ledger query
// itself is covered against a real database in integration/consumption.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { defaultRange, parseRange, type ConsumptionReport } from './consumption.service.js';
import { buildConsumptionXlsx, consumptionFilename } from './consumption-export.js';

describe('date range', () => {
  it('defaults to the current month', () => {
    expect(defaultRange(new Date('2026-02-14T10:00:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(defaultRange(new Date('2028-02-14T10:00:00Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('includes the whole last day', () => {
    const r = parseRange('2026-10-01', '2026-10-31');
    expect(r.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it.each([
    ['2026-10-31', '2026-10-01', /after the end date/],
    ['01/10/2026', '2026-10-31', /YYYY-MM-DD/],
    ['2026-13-01', '2026-13-02', /Invalid date/],
  ])('refuses %s to %s', (from, to, message) => {
    expect(() => parseRange(from, to)).toThrow(message);
  });
});

const REPORT: ConsumptionReport = {
  from: '2026-10-01',
  to: '2026-10-31',
  currency: 'ZAR',
  items: [
    { materialId: 'm-1', sku: 'CON-1', name: 'Grinding disc', category: 'CONSUMABLES', unitOfMeasure: 'each', issued: 30, returned: 5, used: 25, unitCost: 42.05, value: 1051.25 },
    { materialId: 'm-2', sku: 'PRJ-1', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', issued: 2.5, returned: 0, used: 2.5, unitCost: null, value: null },
  ],
  byProject: [{ projectNumber: 'AFRI-1325', projectName: 'Plant upgrade', value: 1051.25, items: 2 }, { projectNumber: null, projectName: null, value: 0, items: 1 }],
  byCategory: [{ category: 'CONSUMABLES', value: 1051.25, items: 1 }, { category: 'PROJECT_MATERIAL', value: 0, items: 1 }],
  total: { value: 1051.25, items: 2, unpriced: 1 },
};

describe('consumption export', () => {
  async function load() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildConsumptionXlsx(REPORT, { currency: 'ZAR', scope: 'All projects' })) as unknown as ExcelJS.Buffer);
    return wb;
  }
  const rows = (ws: ExcelJS.Worksheet) => {
    const out: unknown[][] = [];
    ws.eachRow((r) => out.push((r.values as unknown[]).slice(1)));
    return out;
  };

  it('lists items by category with issued, returned, used and value, and a total', async () => {
    const t = rows((await load()).getWorksheet('By item')!);
    expect(t[0]![0]).toBe('Stock used, 2026-10-01 to 2026-10-31');
    expect(String(t[1]![0])).toContain('All projects. Used = issued − returned');
    expect(t[2]).toEqual(['Code', 'Item', 'Unit', 'Issued', 'Returned', 'Used', 'Unit price (ZAR)', 'Value (ZAR)']);
    expect(t[3]![0]).toBe('Consumables (1)');
    expect(t[4]).toEqual(['CON-1', 'Grinding disc', 'each', 30, 5, 25, 42.05, 1051.25]);
    expect(t[5]!.slice(1)).toEqual(['Subtotal Consumables', undefined, undefined, undefined, undefined, undefined, 1051.25]);
    expect(t[6]![0]).toBe('Project Material (1)');
    expect(t.some((r) => r[1] === 'Total stock used (2 items)' && r[7] === 1051.25)).toBe(true);
    expect(t.some((r) => r[1] === '1 item has no unit price and is not in the total.')).toBe(true);
  });

  it('has a sheet by project, with issues without a project shown as such', async () => {
    const t = rows((await load()).getWorksheet('By project')!);
    expect(t[1]).toEqual(['Project', 'Name', 'Items', 'Value (ZAR)']);
    expect(t[2]).toEqual(['AFRI-1325', 'Plant upgrade', 2, 1051.25]);
    expect(t[3]).toEqual(['No project', '', 1, 0]);
  });

  it('names the file by project and period', () => {
    expect(consumptionFilename(REPORT)).toBe('afrinov-consumption-2026-10-01-to-2026-10-31.xlsx');
    expect(consumptionFilename(REPORT, 'AFRI 13/25')).toBe('afrinov-consumption-AFRI-13-25-2026-10-01-to-2026-10-31.xlsx');
  });
});
