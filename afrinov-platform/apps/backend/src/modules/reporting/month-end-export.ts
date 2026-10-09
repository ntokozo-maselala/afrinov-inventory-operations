// The month-end workbook, in the stock workbook's own layout so management
// reads it the way it always has: an Overview, then per category a Summary
// sheet (S.N # … URGENCY, total above the table) and a Used sheet ("Used
// Stock Inventory": Product ID, Item Name, Rack, Stock Used In QTY, Stock In
// Value Ex VAT).
import ExcelJS from 'exceljs';
import type { MonthEndReport } from './month-end.service.js';

/** Sheet names as the workbook shortens them (Excel allows 31 characters). */
const SHEET: Record<string, { summary: string; used: string; label: string; title: string }> = {
  CONSUMABLES: { summary: 'Stock Summary', used: 'Consumables Used', label: 'Consumables', title: 'STOCK INVENTORY' },
  FASTENERS_SLUGS_INSULATION: { summary: 'FS&I Stock Summary', used: 'FS&I Used', label: 'Fasteners, Slugs & Insulation', title: 'STOCK INVENTORY' },
  TOOLING_PPE_ELECTRICAL: { summary: 'TP&E Stock Summary', used: 'TP&E Used', label: 'Tooling, PPE & Electrical', title: 'STOCK INVENTORY' },
  PROJECT_MATERIAL: { summary: 'Project Stock Summary', used: 'Project Used', label: 'Project Material', title: 'PROJECT INVENTORY' },
  TOOLS: { summary: 'Tools Summary', used: 'Tools Used', label: 'Tools', title: 'STOCK INVENTORY' },
};

const QTY = '#,##0.####';
const MONEY = '#,##0.00';
const FILL: Record<string, string> = { URGENT: 'FFF8D7DA', WARNING: 'FFFFF3CD', OK: 'FFD4EDDA' };
const URGENCY: Record<string, string> = { URGENT: 'URGENT', WARNING: 'WARNING', OK: 'OK', NOT_SET: 'NOT SET' };

/** Build the XLSX download name from a YYYY-MM month without validating it. */
export function monthEndFilename(month: string): string {
  return `afrinov-month-end-${month}.xlsx`;
}

/** Format the report's final day in UTC using the en-ZA long date format. */
function monthLabel(r: MonthEndReport): string {
  const d = new Date(`${r.to}T00:00:00Z`);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Apply bold, wrapped header styling and gray cell fills to the supplied row. */
function headerRow(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.alignment = { wrapText: true, vertical: 'middle' };
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });
}

/**
 * Serialize the supplied report to XLSX bytes: Overview, then Summary and Used
 * sheets for each category. Uses the supplied values and totals without fetching
 * or recalculating stock; null item values become blank cells.
 * @throws Propagates workbook construction and serialization errors.
 */
export async function buildMonthEndXlsx(r: MonthEndReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Afrinov IMS';
  const asAt = monthLabel(r);

  // ── Overview ──────────────────────────────────────────────────────────
  const ov = wb.addWorksheet('Overview');
  ov.columns = [{ width: 32 }, { width: 10 }, { width: 10 }, { width: 18 }, { width: 10 }, { width: 10 }, { width: 18 }];
  ov.getCell('A1').value = `Month-end stock report, ${r.month}`;
  ov.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFE3001B' } };
  ov.getCell('A2').value = `Stock as at the end of ${asAt}; stock used from ${r.from} to ${r.to}. `
    + `Values excl. VAT, ${r.currency}, at unit prices now. URGENT below ${r.bands.urgentBelowPercent}% of Required Stock, `
    + `WARNING below ${r.bands.warningBelowPercent}%.`;
  ov.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };
  const oh = ov.getRow(4);
  oh.values = ['Category', 'Items', 'In stock', `Stock value (${r.currency})`, 'Urgent', 'Warning', `Used in month (${r.currency})`];
  headerRow(oh);
  for (const c of r.categories) {
    const row = ov.addRow([SHEET[c.category]?.label ?? c.category, c.items.length, c.itemsInStock, c.value, c.urgent, c.warning, c.usedValue]);
    row.getCell(4).numFmt = MONEY;
    row.getCell(7).numFmt = MONEY;
  }
  const ot = ov.addRow(['Total', r.total.items, r.total.itemsInStock, r.total.value, r.total.urgent, r.total.warning, r.total.usedValue]);
  ot.font = { bold: true };
  ot.getCell(4).numFmt = MONEY;
  ot.getCell(7).numFmt = MONEY;

  for (const c of r.categories) {
    const names = SHEET[c.category] ?? { summary: c.category.slice(0, 31), used: `${c.category.slice(0, 26)} Used`, label: c.category, title: 'STOCK INVENTORY' };

    // ── Summary: as the workbook's Stock Summary sheets ──────────────────
    const ws = wb.addWorksheet(names.summary, { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = [
      { width: 7 }, { width: 14 }, { width: 44 }, { width: 18 }, { width: 10 }, { width: 10 },
      { width: 14 }, { width: 10 }, { width: 12 }, { width: 11 }, { width: 11 },
    ];
    ws.getCell('B2').value = c.value;
    ws.getCell('B2').numFmt = MONEY;
    ws.getCell('B2').font = { bold: true, size: 14 };
    ws.getCell('B3').value = `${names.title} — as at ${asAt}`;
    ws.getCell('B3').font = { bold: true };
    const sh = ws.getRow(4);
    sh.values = ['S.N #:', 'Product ID', 'Item Name', 'Location', 'Required Stock', 'Current Stock', 'Stock Value VAT Exl',
      '% In Stock Re-Up', 'Unit Price Ex VAT', 'Re Order IN QTY', 'URGENCY'];
    headerRow(sh);
    c.items.forEach((i, n) => {
      const row = ws.addRow([n + 1, i.sku, i.name, i.location, i.requiredStock, i.currentStock, i.value, i.percentOfRequired, i.unitCost, i.reorderQuantity, URGENCY[i.status]]);
      for (const k of [5, 6, 10]) row.getCell(k).numFmt = QTY;
      row.getCell(7).numFmt = MONEY;
      row.getCell(8).numFmt = '0%';
      row.getCell(9).numFmt = MONEY;
      const fill = FILL[i.status];
      if (fill) row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });

    // ── Used: as the workbook's Stock Report sheets ──────────────────────
    const wu = wb.addWorksheet(names.used, { views: [{ state: 'frozen', ySplit: 5 }] });
    wu.columns = [{ width: 14 }, { width: 44 }, { width: 18 }, { width: 14 }, { width: 16 }];
    wu.getCell('A3').value = c.usedValue;
    wu.getCell('A3').numFmt = MONEY;
    wu.getCell('A3').font = { bold: true, size: 14 };
    wu.getCell('A4').value = `Used Stock Inventory — ${r.from} to ${r.to}`;
    wu.getCell('A4').font = { bold: true };
    const uh = wu.getRow(5);
    uh.values = ['Product ID', 'Item Name', 'Rack', 'Stock Used In QTY', 'Stock In Value Ex VAT'];
    headerRow(uh);
    if (c.used.length === 0) wu.addRow(['', 'Nothing was used in this month.']);
    for (const u of c.used) {
      const row = wu.addRow([u.sku, u.name, u.location, u.used, u.value]);
      row.getCell(4).numFmt = QTY;
      row.getCell(5).numFmt = MONEY;
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
