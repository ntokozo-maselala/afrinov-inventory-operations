// Download the re-order list (every URGENT and WARNING item, or those in one
// category) as Excel, or as a PDF copy to send or file.
//
// Live: GET /reports/reorder-list/export, built by the backend's
// reorder-export.ts. Frontend-only mode has no server, so the same sheet is
// built here from the mock's stock status, with the same columns and order.
import { api, FRONTEND_ONLY, getToken } from './client';
import { errorMessage, filenameFromDisposition, triggerDownload } from './exportReport';
import type { StockStatusItem } from '../pages/StockStatus';
import { CATEGORIES, categoryLabel } from '../lib/categories';
import { downloadPdf, type PdfTable } from '../lib/pdf';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const QTY = '#,##0.####';
const MONEY = '#,##0.00';
const fallbackName = (category?: string, extension: 'xlsx' | 'pdf' = 'xlsx') =>
  `afrinov-reorder-list${category ? `-${category.toLowerCase().replace(/_/g, '-')}` : ''}-${new Date().toISOString().slice(0, 10)}.${extension}`;
const categoryQuery = (category?: string) => (category ? `&category=${encodeURIComponent(category)}` : '');

/** `category` limits the list to that category; leave it out for all of them. */
export async function downloadReorderList(category?: string): Promise<void> {
  if (FRONTEND_ONLY) {
    triggerDownload(new Blob([await buildInBrowser(category)], { type: XLSX }), fallbackName(category));
    return;
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1/reports/reorder-list/export${category ? `?category=${encodeURIComponent(category)}` : ''}`, {
      headers: { Accept: XLSX, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('Download failed: the file was empty.');
  triggerDownload(blob, filenameFromDisposition(res.headers.get('content-disposition'), fallbackName(category)));
}

async function buildInBrowser(category?: string): Promise<ArrayBuffer> {
  const [rows, settings] = await Promise.all([
    api.get<StockStatusItem[]>(`/reports/stock-status?status=URGENT,WARNING${categoryQuery(category)}`),
    api.get<Array<{ key: string; value: unknown }>>('/settings'),
  ]);
  const setting = (key: string, fallback: unknown) => settings.find((s) => s.key === key)?.value ?? fallback;
  const urgent = setting('inventory.urgentBelowPercent', 20);
  const warning = setting('inventory.warningBelowPercent', 40);
  const currency = String(setting('general.defaultCurrency', 'ZAR'));

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Re-order list', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.getCell('A1').value = category ? `Re-order list: ${categoryLabel(category)}` : 'Re-order list';
  ws.getCell('A2').value = `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC. `
    + `Items below ${warning}% of their Required Stock (urgent below ${urgent}%). `
    + `Re-order quantity = Required Stock − on hand. Prices excl. VAT, ${currency}.`;
  ws.getRow(4).values = ['Code', 'Item', 'Unit', 'Status', 'On hand', 'Required', '% of required', 'Re-order qty',
    `Unit price (${currency})`, `Re-order value (${currency})`, 'Last supplier', 'Last delivered', 'Where it is kept'];
  ws.getRow(4).font = { bold: true };
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 13 } };

  const order = CATEGORIES.map((c) => c.value);
  const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  let total = 0;
  let unpriced = 0;
  for (const category of categories) {
    const group = rows.filter((r) => r.category === category);
    ws.addRow([`${categoryLabel(category)} (${group.length})`]).font = { bold: true };
    let subtotal = 0;
    for (const r of group) {
      const reorder = Number(r.reorderQuantity);
      const price = r.unitCost === null ? null : Number(r.unitCost);
      const value = price === null ? null : Math.round(reorder * price * 100) / 100;
      if (value === null) unpriced++;
      else subtotal += value;
      const row = ws.addRow([
        r.sku, r.name, r.unitOfMeasure, r.status === 'URGENT' ? 'Urgent' : 'Warning',
        Number(r.onHand), Number(r.requiredStock), r.percentOfRequired === null ? null : r.percentOfRequired / 100,
        reorder, price, value, r.lastSupplier?.name ?? '',
        r.lastSupplier ? new Date(r.lastSupplier.receivedAt) : null,
        r.locations.map((l) => `${l.locationName} (${Number(l.quantity)})`).join(', ') || 'None on hand',
      ]);
      for (const col of [5, 6, 8]) row.getCell(col).numFmt = QTY;
      row.getCell(7).numFmt = '0.0%';
      row.getCell(9).numFmt = MONEY;
      row.getCell(10).numFmt = MONEY;
      row.getCell(12).numFmt = 'yyyy-mm-dd';
    }
    ws.addRow([null, `Subtotal ${categoryLabel(category)}`, null, null, null, null, null, null, null, Math.round(subtotal * 100) / 100]).font = { bold: true };
    ws.addRow([]);
    total += subtotal;
  }
  if (rows.length === 0) {
    ws.addRow([`Nothing ${category ? `in ${categoryLabel(category)} ` : ''}needs re-ordering: every item with a Required Stock is at or above the warning level.`]);
  } else {
    ws.addRow([null, `Total re-order value (${rows.length} items)`, null, null, null, null, null, null, null, Math.round(total * 100) / 100]).font = { bold: true };
    if (unpriced > 0) ws.addRow([null, `${unpriced} item${unpriced === 1 ? ' has' : 's have'} no unit price and ${unpriced === 1 ? 'is' : 'are'} not in the total.`]);
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * The re-order list as a PDF: what to order per category, then each category's
 * items with the quantity, price and value. The same items as the Excel file;
 * where the stock is kept is left out to fit the page.
 */
export async function downloadReorderListPdf(category?: string): Promise<void> {
  const [rows, values] = await Promise.all([
    api.get<StockStatusItem[]>(`/reports/stock-status?status=URGENT,WARNING${categoryQuery(category)}`),
    api.get<Record<string, unknown>>('/settings/values?keys=inventory.urgentBelowPercent,inventory.warningBelowPercent,general.defaultCurrency'),
  ]);
  const urgent = Number(values['inventory.urgentBelowPercent'] ?? 20);
  const warning = Number(values['inventory.warningBelowPercent'] ?? 40);
  const currency = String(values['general.defaultCurrency'] ?? 'ZAR');
  const money = (n: number) => formatCurrency(n, currency);
  const value = (r: StockStatusItem) => (r.unitCost === null ? null : Math.round(Number(r.reorderQuantity) * Number(r.unitCost) * 100) / 100);

  const order = CATEGORIES.map((c) => c.value);
  const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const subtotal = (c: string) => rows.filter((r) => r.category === c).reduce((sum, r) => sum + (value(r) ?? 0), 0);
  const total = categories.reduce((sum, c) => sum + subtotal(c), 0);
  const unpriced = rows.filter((r) => r.unitCost === null).length;

  const summary: PdfTable = {
    heading: 'Summary',
    columns: [{ header: 'Category' }, { header: 'Urgent', align: 'right', width: 22 }, { header: 'Warning', align: 'right', width: 22 }, { header: `Re-order value (${currency})`, align: 'right', width: 40 }],
    rows: categories.map((c) => {
      const group = rows.filter((r) => r.category === c);
      return [categoryLabel(c), String(group.filter((r) => r.status === 'URGENT').length), String(group.filter((r) => r.status === 'WARNING').length), money(subtotal(c))];
    }),
    totals: [[`Total (${rows.length} items)`, String(rows.filter((r) => r.status === 'URGENT').length), String(rows.filter((r) => r.status === 'WARNING').length), money(total)]],
    empty: `Nothing ${category ? `in ${categoryLabel(category)} ` : ''}needs re-ordering: every item with a Required Stock is at or above the warning level.`,
  };
  const detail: PdfTable[] = categories.map((c) => {
    const group = rows.filter((r) => r.category === c);
    return {
      heading: `${categoryLabel(c)} (${group.length})`,
      columns: [
        { header: 'Code', width: 26 }, { header: 'Item' }, { header: 'Status', width: 16 },
        { header: 'On hand', align: 'right', width: 18 }, { header: 'Required', align: 'right', width: 18 },
        { header: '% of req.', align: 'right', width: 16 }, { header: 'Re-order qty', align: 'right', width: 20 },
        { header: 'Unit', width: 14 }, { header: 'Unit price', align: 'right', width: 24 },
        { header: 'Re-order value', align: 'right', width: 26 }, { header: 'Last supplier', width: 40 },
      ],
      rows: group.map((r) => {
        const v = value(r);
        return [
          r.sku, r.name, r.status === 'URGENT' ? 'Urgent' : 'Warning',
          formatNumber(Number(r.onHand)), formatNumber(Number(r.requiredStock)),
          r.percentOfRequired === null ? '' : `${r.percentOfRequired.toFixed(1)}%`, formatNumber(Number(r.reorderQuantity)),
          r.unitOfMeasure, r.unitCost === null ? '-' : money(Number(r.unitCost)), v === null ? '-' : money(v), r.lastSupplier?.name ?? '',
        ];
      }),
      totals: [['', `Subtotal ${categoryLabel(c)}`, '', '', '', '', '', '', '', money(subtotal(c)), '']],
    };
  });

  await downloadPdf({
    title: category ? `Re-order list: ${categoryLabel(category)}` : 'Re-order list',
    lines: [
      category ? `Category: ${categoryLabel(category)}` : 'All categories',
      `Items below ${warning}% of their Required Stock (urgent below ${urgent}%). Re-order quantity = Required Stock - on hand. Prices excl. VAT, ${currency}.`,
    ],
    sections: [summary, ...detail],
    notes: unpriced > 0 ? [`${unpriced} item${unpriced === 1 ? ' has' : 's have'} no unit price and ${unpriced === 1 ? 'is' : 'are'} not in the totals.`] : [],
  }, fallbackName(category, 'pdf'));
}
