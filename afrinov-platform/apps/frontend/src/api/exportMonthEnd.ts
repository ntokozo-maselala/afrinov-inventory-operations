// Download the stock report. Live: the backend's
// GET /reports/month-end/export. Frontend-only mode builds the same workbook
// here, in the stock workbook's layout, from the mock stock report.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { MonthEndReport } from './reportTypes';
import { downloadPdf, type PdfTable } from '../lib/pdf';
import { formatDate, formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { today } from '../lib/dates';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The download name: the month when the report covers one, otherwise both dates (as the server names it). */
export function stockReportFilename(r: Pick<MonthEndReport, 'month' | 'from' | 'to'>, extension: 'xlsx' | 'pdf' = 'xlsx'): string {
  return `afrinov-stock-report-${r.month ?? `${r.from}-to-${r.to}`}.${extension}`;
}

/**
 * Start an XLSX download for a YYYY-MM-DD from/to period (both days included),
 * fetching the live export or building it locally in frontend-only mode. Resolves after triggering the
 * browser download, without waiting for the file to be saved.
 * @throws {Error} For live network failures, non-success responses, or empty files.
 * Network failures get a connection message; unreadable error responses use the
 * HTTP status. Report, workbook, response-body, and browser errors propagate.
 */
export async function downloadMonthEnd(range: { from: string; to: string }): Promise<void> {
  const query = new URLSearchParams(range).toString();
  if (FRONTEND_ONLY) {
    const r = await api.get<MonthEndReport>(`/reports/month-end?${query}`);
    triggerDownload(new Blob([await buildInBrowser(r)], { type: XLSX }), stockReportFilename(r));
    return;
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1/reports/month-end/export?${query}`, {
      headers: { Accept: XLSX, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('Download failed: the file was empty.');
  triggerDownload(blob, filenameFromDisposition(res.headers.get('content-disposition'), stockReportFilename({ month: null, ...range })));
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
 * Return XLSX bytes with an Overview and per-category Summary and Used sheets,
 * using the report's values and totals.
 * @throws Propagates ExcelJS loading and workbook generation errors.
 */
async function buildInBrowser(r: MonthEndReport): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ov = wb.addWorksheet('Overview');
  ov.getCell('A1').value = `Stock report, ${r.month ?? `${r.from} to ${r.to}`}`;
  ov.getCell('A2').value = `Stock as at the end of ${r.to}; stock used from ${r.from} to ${r.to}. Values excl. VAT, ${r.currency}.`;
  ov.getRow(4).values = ['Category', 'Items', 'In stock', `Stock value (${r.currency})`, 'Urgent', 'Warning', `Used in period (${r.currency})`];
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
    if (c.used.length === 0) wu.addRow(['', 'Nothing was used in this period.']);
    for (const u of c.used) wu.addRow([u.sku, u.name, u.location, u.used, u.value]);
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * The stock report as a PDF, laid out as the workbook is: the overview per
 * category, then each category on its own page with its stock summary (the
 * Summary sheet's columns) and the stock used in the period (its Used sheet).
 */
export async function downloadMonthEndPdf(range: { from: string; to: string }): Promise<void> {
  const r = await api.get<MonthEndReport>(`/reports/month-end?${new URLSearchParams(range).toString()}`);
  const money = (n: number | null) => (n === null ? '-' : formatCurrency(n, r.currency));
  const label = (c: string) => SHEET[c]?.label ?? c;
  const period = r.month
    ? new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${formatDate(r.from)} to ${formatDate(r.to)}`;
  const asAt = r.to >= today() ? 'as it stands now' : `as at the end of ${formatDate(r.to)}`;

  const sections: PdfTable[] = [{
    heading: 'Overview',
    columns: [
      { header: 'Category', wrap: true }, { header: 'Items', align: 'right' }, { header: 'In stock', align: 'right' },
      { header: `Stock value (${r.currency})`, align: 'right' }, { header: 'Urgent', align: 'right' },
      { header: 'Warning', align: 'right' }, { header: `Used in period (${r.currency})`, align: 'right' },
    ],
    rows: r.categories.map((c) => [label(c.category), formatNumber(c.items.length), formatNumber(c.itemsInStock), money(c.value), formatNumber(c.urgent), formatNumber(c.warning), money(c.usedValue)]),
    totals: [['Total', formatNumber(r.total.items), formatNumber(r.total.itemsInStock), money(r.total.value), formatNumber(r.total.urgent), formatNumber(r.total.warning), money(r.total.usedValue)]],
    empty: 'No items in stock or used in this period.',
  }];
  for (const c of r.categories) {
    const title = SHEET[c.category]?.title ?? 'STOCK INVENTORY';
    sections.push({
      newPage: true,
      heading: `${label(c.category)}: ${title.toLowerCase().replace(/^\w/, (x) => x.toUpperCase())} ${asAt}`,
      columns: [
        { header: 'S.N', align: 'right' }, { header: 'Product ID' }, { header: 'Item Name', wrap: true }, { header: 'Location', wrap: true },
        { header: 'Required Stock', align: 'right' }, { header: 'Current Stock', align: 'right' },
        { header: 'Stock Value Ex VAT', align: 'right' }, { header: '% In Stock', align: 'right' },
        { header: 'Unit Price Ex VAT', align: 'right' }, { header: 'Re-order Qty', align: 'right' }, { header: 'Urgency' },
      ],
      rows: c.items.map((i, n) => [
        String(n + 1), i.sku, i.name, i.location, formatNumber(i.requiredStock), formatNumber(i.currentStock), money(i.value),
        i.percentOfRequired === null ? '' : `${i.percentOfRequired.toFixed(1)}%`, money(i.unitCost),
        i.reorderQuantity === null ? '' : formatNumber(i.reorderQuantity), URGENCY[i.status] ?? i.status,
      ]),
      totals: [['', '', `Total ${label(c.category)}`, '', '', '', money(c.value), '', '', '', '']],
      empty: 'No items in this category.',
    });
    sections.push({
      heading: `${label(c.category)}: stock used, ${formatDate(r.from)} to ${formatDate(r.to)}`,
      columns: [
        { header: 'Product ID' }, { header: 'Item Name', wrap: true }, { header: 'Rack', wrap: true },
        { header: 'Stock Used In QTY', align: 'right' }, { header: 'Stock In Value Ex VAT', align: 'right' },
      ],
      rows: c.used.map((u) => [u.sku, u.name, u.location, formatNumber(u.used), money(u.value)]),
      totals: [['', `Total used ${label(c.category)}`, '', '', money(c.usedValue)]],
      empty: 'Nothing was used in this period.',
    });
  }

  await downloadPdf({
    title: `Stock report, ${period}`,
    lines: [
      `Stock ${asAt}; stock used from ${formatDate(r.from)} to ${formatDate(r.to)}. Values excl. VAT, ${r.currency}.`,
      `URGENCY against Required Stock: urgent below ${r.bands.urgentBelowPercent}%, warning below ${r.bands.warningBelowPercent}%.`,
    ],
    sections,
  }, stockReportFilename(r, 'pdf'));
}
