// The re-order list file: built, then read back as the buyer would open it.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildReorderXlsx, reorderFilename } from './reorder-export.js';
import type { StockStatusRow } from './reporting.service.js';

const row = (sku: string, category: string, status: 'URGENT' | 'WARNING', onHand: number, required: number, unitCost: string | null, extra: Partial<StockStatusRow> = {}): StockStatusRow => ({
  materialId: `m-${sku}`, sku, name: `Item ${sku}`, category, unitOfMeasure: 'each',
  requiredStock: String(required), onHand: String(onHand), percentOfRequired: Math.round((onHand / required) * 1000) / 10,
  status, reorderQuantity: String(required - onHand), unitCost,
  locations: onHand > 0 ? [{ locationId: 'l-1', locationName: 'A-1', quantity: String(onHand) }] : [],
  lastSupplier: null, ...extra,
});

const meta = { generatedAt: new Date('2026-10-09T08:30:00Z'), bands: { urgentBelowPercent: 20, warningBelowPercent: 40 }, currency: 'ZAR' };

async function read(rows: StockStatusRow[]): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildReorderXlsx(rows, meta)) as unknown as ExcelJS.Buffer);
  return wb.getWorksheet('Re-order list')!;
}

/** Every row as an array of shown values, from the header down. */
function table(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  ws.eachRow((r, n) => { if (n >= 4) out.push((r.values as unknown[]).slice(1)); });
  return out;
}

describe('re-order list export', () => {
  it('groups items by category, with quantities, values, subtotals and a total', async () => {
    const ws = await read([
      row('TPE-1', 'TOOLING_PPE_ELECTRICAL', 'WARNING', 30, 100, '4.2'),
      row('CON-1', 'CONSUMABLES', 'URGENT', 11, 100, '42.05', {
        lastSupplier: { name: 'Hydroscand', receivedAt: '2026-09-18T00:00:00.000Z' },
      }),
      row('CON-2', 'CONSUMABLES', 'WARNING', 10, 50, null),
    ]);
    expect(ws.getCell('A1').value).toBe('Re-order list');
    expect(String(ws.getCell('A2').value)).toContain('below 40% of their Required Stock (urgent below 20%)');

    const t = table(ws);
    expect(t[0]!.slice(0, 10)).toEqual(['Code', 'Item', 'Unit', 'Status', 'On hand', 'Required', '% of required', 'Re-order qty', 'Unit price (ZAR)', 'Re-order value (ZAR)']);
    // Consumables first (the workbook's order), then Tooling.
    expect(t[1]![0]).toBe('Consumables (2)');
    expect(t[2]!.slice(0, 11)).toEqual(['CON-1', 'Item CON-1', 'each', 'Urgent', 11, 100, 0.11, 89, 42.05, 3742.45, 'Hydroscand']);
    expect(t[2]![11]).toEqual(new Date('2026-09-18T00:00:00.000Z'));
    expect(t[3]!.slice(0, 11)).toEqual(['CON-2', 'Item CON-2', 'each', 'Warning', 10, 50, 0.2, 40, undefined, undefined, '']);
    expect(t[4]!.slice(1, 10)).toEqual(['Subtotal Consumables', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 3742.45]);
    // Blank spacer rows are skipped when reading back.
    expect(t[5]![0]).toBe('Tooling, PPE & Electrical (1)');
    expect(t[6]!.slice(7, 10)).toEqual([70, 4.2, 294]);

    const totalRow = t.find((r) => String(r[1] ?? '').startsWith('Total re-order value'))!;
    expect(totalRow[1]).toBe('Total re-order value (3 items)');
    expect(totalRow[9]).toBe(4036.45);
    expect(t.some((r) => r[1] === '1 item has no unit price and is not in the total.')).toBe(true);
  });

  it('keeps numbers as numbers, with formats for Excel', async () => {
    const ws = await read([row('CON-1', 'CONSUMABLES', 'URGENT', 11, 100, '42.05')]);
    const r = ws.getRow(6);
    expect(typeof r.getCell(8).value).toBe('number');
    expect(r.getCell(7).numFmt).toBe('0.0%');
    expect(r.getCell(10).numFmt).toBe('#,##0.00');
  });

  it('says so when nothing needs re-ordering', async () => {
    const t = table(await read([]));
    expect(String(t[1]![0])).toMatch(/^Nothing needs re-ordering/);
  });

  it('names the file by date', () => {
    expect(reorderFilename(meta.generatedAt)).toBe('afrinov-reorder-list-2026-10-09.xlsx');
  });
});
