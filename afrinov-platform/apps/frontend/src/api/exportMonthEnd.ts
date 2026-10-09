// Download the month-end report. Live: the backend's
// GET /reports/month-end/export. Frontend-only mode builds the same workbook
// here, in the stock workbook's layout, from the mock month-end report.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { MonthEndReport } from './reportTypes';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Start an XLSX download for a YYYY-MM month, fetching the live export or
 * building it locally in frontend-only mode. Resolves after triggering the
 * browser download, without waiting for the file to be saved.
 * @throws {Error} For live network failures, non-success responses, or empty files.
 * Network failures get a connection message; unreadable error responses use the
 * HTTP status. Report, workbook, response-body, and browser errors propagate.
 */
export async function downloadMonthEnd(month: string): Promise<void> {
  const fallback = `afrinov-month-end-${month}.xlsx`;
  if (FRONTEND_ONLY) {
    triggerDownload(new Blob([await buildInBrowser(month)], { type: XLSX }), fallback);
    return;
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1/reports/month-end/export?month=${encodeURIComponent(month)}`, {
      headers: { Accept: XLSX, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('Download failed: the file was empty.');
  triggerDownload(blob, filenameFromDisposition(res.headers.get('content-disposition'), fallback));
}

const SHEET: Record<string, { summary: string; used: string; label: string; title: string }> = {
  CONSUMABLES: { summary: 'Stock Summary', used: 'Consumables Used', label: 'Consumables', title: 'STOCK INVENTORY' },
  FASTENERS_SLUGS_INSULATION: { summary: 'FS&I Stock Summary', used: 'FS&I Used', label: 'Fasteners, Slugs & Insulation', title: 'STOCK INVENTORY' },
  TOOLING_PPE_ELECTRICAL: { summary: 'TP&E Stock Summary', used: 'TP&E Used', label: 'Tooling, PPE & Electrical', title: 'STOCK INVENTORY' },
  PROJECT_MATERIAL: { summary: 'Project Stock Summary', used: 'Project Used', label: 'Project Material', title: 'PROJECT INVENTORY' },
  TOOLS: { summary: 'Tools Summary', used: 'Tools Used', label: 'Tools', title: 'STOCK INVENTORY' },
};
const URGENCY: Record<string, string> = { URGENT: 'URGENT', WARNING: 'WARNING', OK: 'OK', NOT_SET: 'NOT SET' };

/**
 * Fetch a YYYY-MM month's report and return XLSX bytes with an Overview and
 * per-category Summary and Used sheets, using the report's values and totals.
 * @throws Propagates report, ExcelJS loading, and workbook generation errors.
 */
async function buildInBrowser(month: string): Promise<ArrayBuffer> {
  const r = await api.get<MonthEndReport>(`/reports/month-end?month=${encodeURIComponent(month)}`);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ov = wb.addWorksheet('Overview');
  ov.getCell('A1').value = `Month-end stock report, ${r.month}`;
  ov.getCell('A2').value = `Stock as at the end of ${r.to}; stock used from ${r.from} to ${r.to}. Values excl. VAT, ${r.currency}.`;
  ov.getRow(4).values = ['Category', 'Items', 'In stock', `Stock value (${r.currency})`, 'Urgent', 'Warning', `Used in month (${r.currency})`];
  ov.getRow(4).font = { bold: true };
  for (const c of r.categories) ov.addRow([SHEET[c.category]?.label ?? c.category, c.items.length, c.itemsInStock, c.value, c.urgent, c.warning, c.usedValue]);
  ov.addRow(['Total', r.total.items, r.total.itemsInStock, r.total.value, r.total.urgent, r.total.warning, r.total.usedValue]).font = { bold: true };

  for (const c of r.categories) {
    const names = SHEET[c.category] ?? { summary: c.category.slice(0, 31), used: `${c.category.slice(0, 26)} Used`, label: c.category, title: 'STOCK INVENTORY' };
    const ws = wb.addWorksheet(names.summary);
    ws.getCell('B2').value = c.value;
    ws.getCell('B3').value = `${names.title} — as at ${r.to}`;
    ws.getRow(4).values = ['S.N #:', 'Product ID', 'Item Name', 'Location', 'Required Stock', 'Current Stock', 'Stock Value VAT Exl',
      '% In Stock Re-Up', 'Unit Price Ex VAT', 'Re Order IN QTY', 'URGENCY'];
    ws.getRow(4).font = { bold: true };
    c.items.forEach((i, n) => ws.addRow([n + 1, i.sku, i.name, i.location, i.requiredStock, i.currentStock, i.value, i.percentOfRequired, i.unitCost, i.reorderQuantity, URGENCY[i.status]]));

    const wu = wb.addWorksheet(names.used);
    wu.getCell('A3').value = c.usedValue;
    wu.getCell('A4').value = `Used Stock Inventory — ${r.from} to ${r.to}`;
    wu.getRow(5).values = ['Product ID', 'Item Name', 'Rack', 'Stock Used In QTY', 'Stock In Value Ex VAT'];
    wu.getRow(5).font = { bold: true };
    if (c.used.length === 0) wu.addRow(['', 'Nothing was used in this month.']);
    for (const u of c.used) wu.addRow([u.sku, u.name, u.location, u.used, u.value]);
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
