// Export helpers — triggers a download of the file returned by the
// `/api/v1/reports/inventory/export?format=...` endpoint.
//
// In real-backend mode the endpoint streams a generated buffer
// (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet or
// application/pdf). In frontend-only mock mode, the same endpoint shape is
// exposed but we cannot generate server-side; instead we derive a binary
// payload from the in-memory report using the same shape, so the download
// is consistent (XLSX via exceljs, PDF via a minimal hand-built PDF).
//
// The two paths are designed to produce byte-identical *kinds* of files
// with the same data and column ordering.
import { getToken } from './client';
import type { ReportResult } from './reportTypes';
import { FRONTEND_ONLY } from './client';
import { useToast } from '../components/Toast';
import { categoryLabel } from '../lib/categories';

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function openInNewTab(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error('Popup blocked — please allow popups for this site to preview PDFs.');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function buildFilename(report: ReportResult, ext: 'xlsx' | 'pdf'): string {
  const slug = (report.kpis.rangeLabel || 'all-time').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const date = report.generatedAt.slice(0, 10);
  return `afrinov-inventory-report-${slug}-${date}.${ext}`;
}

type ExportFormat = 'xlsx' | 'pdf';

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// This path deliberately excludes the API version prefix. The shared API
// client owns it, and including it twice previously made export requests 404.
// queryString is the exact report query used to load the visible report.
export function buildInventoryExportPath(format: ExportFormat, queryString = ''): string {
  const params = new URLSearchParams(queryString);
  params.set('format', format);
  return `/reports/inventory/export?${params.toString()}`;
}

export async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // A proxy may return a non-JSON error page.
  }
  return `Request failed (${response.status})`;
}

export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i);
  if (!match?.[1]) return fallback;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return fallback;
  }
}

async function fetchExportBlob(
  report: ReportResult,
  format: ExportFormat,
  queryString = '',
): Promise<{ blob: Blob; filename: string }> {
  const url = buildInventoryExportPath(format, queryString);
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1${url}`, {
      method: 'GET',
      headers: {
        Accept: CONTENT_TYPES[format],
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(await errorMessage(res));

  const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes(CONTENT_TYPES[format])) {
    throw new Error(`Export failed: the server returned ${contentType || 'an unknown content type'} instead of ${CONTENT_TYPES[format]}.`);
  }
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('Export failed: the generated file was empty.');
  return { blob, filename: filenameFromDisposition(res.headers.get('content-disposition'), buildFilename(report, format)) };
}

// A Blob download is reliable after an awaited request; opening a new window
// at that point is commonly rejected by popup blockers in production.
async function downloadFromBackend(report: ReportResult, format: ExportFormat, queryString: string): Promise<void> {
  const { blob, filename } = await fetchExportBlob(report, format, queryString);
  triggerDownload(blob, filename);
}

// Frontend-only path — build the same content client-side from the same
// in-memory report so the data is identical to what the user is looking at.
async function downloadFromMock(report: ReportResult, format: ExportFormat): Promise<void> {
  if (format === 'xlsx') {
    const buf = await buildXlsxInBrowser(report);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    triggerDownload(blob, buildFilename(report, 'xlsx'));
    return;
  }
  const buf = buildPdfInBrowser(report);
  const blob = new Blob([buf], { type: CONTENT_TYPES.pdf });
  triggerDownload(blob, buildFilename(report, 'pdf'));
}

async function fetchPdfBlob(report: ReportResult, queryString = ''): Promise<{ blob: Blob; filename: string }> {
  return fetchExportBlob(report, 'pdf', queryString);
}

async function buildPdfBlobInBrowser(report: ReportResult): Promise<{ blob: Blob; filename: string }> {
  const buf = buildPdfInBrowser(report);
  const blob = new Blob([buf], { type: 'application/pdf' });
  return { blob, filename: buildFilename(report, 'pdf') };
}

export async function getPdfBlob(report: ReportResult, queryString = ''): Promise<{ blob: Blob; filename: string }> {
  if (FRONTEND_ONLY) return buildPdfBlobInBrowser(report);
  return fetchPdfBlob(report, queryString);
}

export async function exportInventoryReport(
  report: ReportResult,
  format: ExportFormat,
  queryString = '',
): Promise<void> {
  if (FRONTEND_ONLY) return downloadFromMock(report, format);
  return downloadFromBackend(report, format, queryString);
}

// ── Browser-side XLSX builder (reuses exceljs to keep the workbook structure
//    identical to the server-side output) ──────────────────────────────────
// ExcelJS (~1.4MB) is loaded on-demand via dynamic import so it is excluded
// from the main bundle and only fetched when the user actually exports.
async function buildXlsxInBrowser(report: ReportResult): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Afrinov IMS';
  wb.created = new Date(report.generatedAt);
  const fmtQty = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  const fmtCurrency = (n: number, ccy: string) => n.toLocaleString('en-ZA', { style: 'currency', currency: ccy, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDateTime = (iso: string | null) => iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 19) : '';
  const stLabel = (s: string) => ({ IN_STOCK: 'In stock', LOW_STOCK: 'Low stock', OUT_OF_STOCK: 'Out of stock' } as Record<string, string>)[s] ?? s;

  const summary = wb.addWorksheet('Summary');
  summary.getCell('A1').value = 'Afrinov Inventory Report';
  summary.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFE3001B' } };
  summary.getRow(1).height = 26;
  summary.addRow(['Generated', fmtDateTime(report.generatedAt)]);
  summary.addRow(['Reporting period', report.kpis.rangeLabel]);
  summary.addRow(['Currency', report.currency]);
  summary.addRow([]);
  summary.addRow(['KPI', 'Value']).font = { bold: true };
  for (const [k, v] of [
    ['Total SKUs', String(report.kpis.skuCount)],
    ['Total quantity', fmtQty(report.kpis.totalQuantity)],
    ['Inventory value', fmtCurrency(report.kpis.inventoryValue, report.currency)],
    ['Low stock items', String(report.kpis.lowStockCount)],
    ['Out of stock items', String(report.kpis.outOfStockCount)],
    ['Categories', String(report.kpis.categoryCount)],
    ['Locations', String(report.kpis.locationCount)],
    ['Suppliers', String(report.kpis.supplierCount)],
    ['Movements (in period)', String(report.kpis.movementCount)],
  ] as Array<[string, string]>) {
    summary.addRow([k, v]);
  }
  summary.addRow([]);
  summary.addRow(['Status', 'SKUs', 'Quantity', 'Inventory value']).font = { bold: true };
  for (const s of report.byStatus) summary.addRow([stLabel(s.status), s.skuCount, s.quantity, fmtCurrency(s.inventoryValue, report.currency)]);
  summary.addRow([]);
  summary.addRow(['Category', 'SKUs', 'Quantity', 'Inventory value', 'Share']).font = { bold: true };
  for (const c of report.byCategory) summary.addRow([categoryLabel(c.category), c.skuCount, c.quantity, fmtCurrency(c.inventoryValue, report.currency), c.share]);
  summary.getColumn(5).numFmt = '0.0%';
  summary.views = [{ state: 'frozen', ySplit: 1 }];

  const inv = wb.addWorksheet('Inventory');
  inv.columns = [
    { header: 'Item', key: 'name', width: 40 },
    { header: 'SKU', key: 'sku', width: 24 },
    { header: 'Category', key: 'category', width: 28 },
    { header: 'UoM', key: 'uom', width: 10 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Reorder', key: 'reorder', width: 12 },
    { header: 'Unit cost', key: 'unitCost', width: 14 },
    { header: 'Inventory value', key: 'value', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Location', key: 'location', width: 22 },
    { header: 'Last updated', key: 'updated', width: 20 },
  ];
  inv.getRow(1).font = { bold: true };
  inv.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  for (const l of report.inventory) {
    inv.addRow([l.name, l.sku, categoryLabel(l.category), l.unitOfMeasure, l.quantity, l.requiredStock, l.unitCost ?? '', l.inventoryValue, stLabel(l.status), l.locationName, fmtDateTime(l.lastUpdated)]);
  }
  inv.getColumn(5).numFmt = '#,##0.0000';
  inv.getColumn(6).numFmt = '#,##0.0000';
  inv.getColumn(7).numFmt = '#,##0.00';
  inv.getColumn(8).numFmt = '#,##0.00';
  inv.autoFilter = { from: 'A1', to: `K${Math.max(1, report.inventory.length + 1)}` };
  inv.views = [{ state: 'frozen', ySplit: 1 }];

  const mov = wb.addWorksheet('Movements');
  mov.columns = [
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Item', key: 'name', width: 36 },
    { header: 'SKU', key: 'sku', width: 22 },
    { header: 'Category', key: 'category', width: 26 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Location', key: 'location', width: 22 },
    { header: 'Reference', key: 'ref', width: 22 },
    { header: 'Project', key: 'project', width: 18 },
    { header: 'Reason', key: 'reason', width: 18 },
    { header: 'User', key: 'user', width: 22 },
  ];
  mov.getRow(1).font = { bold: true };
  mov.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  for (const m of report.movements) {
    mov.addRow([fmtDateTime(m.postedAt), m.materialName, m.materialSku, categoryLabel(m.category), m.type, m.quantity, m.locationName, m.referenceType ? `${m.referenceType}${m.referenceId ? '#' + m.referenceId : ''}` : '', m.projectNumber ?? '', m.reasonCode ? `${m.reasonCode}${m.reasonNote ? ' — ' + m.reasonNote : ''}` : '', m.actorName]);
  }
  mov.getColumn(6).numFmt = '#,##0.0000';
  mov.getColumn(1).numFmt = 'yyyy-mm-dd hh:mm:ss';
  mov.autoFilter = { from: 'A1', to: `K${Math.max(1, report.movements.length + 1)}` };
  mov.views = [{ state: 'frozen', ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}

// ── Browser-side PDF builder (very compact, valid PDF 1.4) ───────────────
// Produces a single-page (or multi-page) PDF in plain PDF format with the
// same sections as the server PDF: header, KPIs, status, category, etc.
// Intentionally simple to avoid adding a 200kB library.
function buildPdfInBrowser(report: ReportResult): ArrayBuffer {
  const fmtQty = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  const fmtCurrency = (n: number, c: string) => n.toLocaleString('en-ZA', { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (iso: string | null) => iso ? iso.slice(0, 10) : '';
  const stLabel = (s: string) => ({ IN_STOCK: 'In stock', LOW_STOCK: 'Low stock', OUT_OF_STOCK: 'Out of stock' } as Record<string, string>)[s] ?? s;

  const PAGE_W = 595;
  const PAGE_H = 842;
  const M = 36;
  const LINE = 14;

  interface Obj { idx: number; data: string; }
  const objs: Obj[] = [];
  function addObj(data: string): number {
    const idx = objs.length + 1;
    objs.push({ idx, data });
    return idx;
  }

  // Content stream for one page
  function pageContent(lines: string[]): string {
    return `BT\n/F1 9 Tf\n${M} ${PAGE_H - M} Td\n${lines.map((l, i) => {
      if (i === 0) return `(${escapePdf(l)}) Tj`;
      return `0 -${LINE} Td\n(${escapePdf(l)}) Tj`;
    }).join('\n')}\nET`;
  }
  function escapePdf(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  const pageLines: string[][] = [[]];
  function add(text: string): void {
    const cur = pageLines[pageLines.length - 1]!;
    if (cur.length >= 50) {
      pageLines.push([]);
    }
    pageLines[pageLines.length - 1]!.push(text);
  }

  // Header band: drawn as a filled rectangle on each page
  add(`Afrinov Inventory Report`);
  add(`Generated: ${fmtDate(report.generatedAt)}    Period: ${report.kpis.rangeLabel}    Currency: ${report.currency}`);
  add('');
  add('Executive summary');
  add(`SKUs: ${report.kpis.skuCount}    Total qty: ${fmtQty(report.kpis.totalQuantity)}    Inventory value: ${fmtCurrency(report.kpis.inventoryValue, report.currency)}`);
  add(`Low stock: ${report.kpis.lowStockCount}    Out of stock: ${report.kpis.outOfStockCount}    Categories: ${report.kpis.categoryCount}    Locations: ${report.kpis.locationCount}    Suppliers: ${report.kpis.supplierCount}    Movements: ${report.kpis.movementCount}`);
  add('');
  add('Stock status breakdown');
  for (const s of report.byStatus) add(`  ${stLabel(s.status).padEnd(14)} SKUs=${String(s.skuCount).padStart(4)}  Qty=${fmtQty(s.quantity).padStart(10)}  Value=${fmtCurrency(s.inventoryValue, report.currency)}`);
  add('');
  add('Inventory by category');
  for (const c of report.byCategory) add(`  ${categoryLabel(c.category).padEnd(28)} SKUs=${String(c.skuCount).padStart(3)}  Qty=${fmtQty(c.quantity).padStart(10)}  Value=${fmtCurrency(c.inventoryValue, report.currency).padStart(14)}  Share=${(c.share * 100).toFixed(1)}%`);
  add('');
  add(`Inventory requiring attention (${report.exceptions.length})`);
  for (const l of report.exceptions) {
    add(`  ${l.sku.padEnd(20)} ${l.name.slice(0, 30).padEnd(30)} ${l.locationName.slice(0, 16).padEnd(16)} on-hand=${fmtQty(l.quantity).padStart(8)} reorder=${fmtQty(l.requiredStock).padStart(8)} [${stLabel(l.status)}]`);
  }
  add('');
  add(`Detailed inventory (page ${report.page})`);
  for (const l of report.inventory) {
    add(`  ${l.sku.padEnd(20)} ${l.name.slice(0, 28).padEnd(28)} ${l.locationName.slice(0, 16).padEnd(16)} qty=${fmtQty(l.quantity).padStart(8)} value=${fmtCurrency(l.inventoryValue, report.currency).padStart(12)} [${stLabel(l.status)}]`);
  }
  add('');
  add(`Movements in period (${report.movements.length})`);
  for (const m of report.movements) {
    add(`  ${m.postedAt.slice(0, 16)}  ${m.type.padEnd(12)}  ${m.materialName.slice(0, 26).padEnd(26)}  ${m.locationName.slice(0, 16).padEnd(16)}  qty=${fmtQty(m.quantity)}`);
  }

  // Build content streams
  const contentRefs: number[] = [];
  for (const lines of pageLines) {
    const stream = pageContent(lines);
    const idx = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentRefs.push(idx);
  }

  // Page objects
  const pageRefs: number[] = [];
  for (let i = 0; i < contentRefs.length; i++) {
    const idx = addObj(`<< /Type /Page /Parent PAGES /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 FONTS >> >> /Contents ${contentRefs[i]} >>`);
    pageRefs.push(idx);
  }
  const pagesIdx = addObj(`<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] >>`);
  const fontsIdx = addObj(`<< /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >>`);
  // Replace placeholder references
  objs.forEach((o) => {
    o.data = o.data.replace(/PAGES/g, `${pagesIdx} 0 R`).replace(/FONTS/g, `${fontsIdx} 0 R`);
  });

  // Assemble PDF bytes
  let pdf = `%PDF-1.4\n%âãÏÓ\n`;
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(pdf.length);
    pdf += `${o.idx} 0 obj\n${o.data}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${pagesIdx} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // Encode to ArrayBuffer
  const buf = new ArrayBuffer(pdf.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < pdf.length; i++) view[i] = pdf.charCodeAt(i) & 0xff;
  return buf;
}

// React hook that wires `exportInventoryReport` to the toast system.
export function useReportExporter(report: ReportResult | null, queryString = '') {
  const toast = useToast();
  async function run(format: 'xlsx' | 'pdf'): Promise<void> {
    if (!report) return;
    try {
      await exportInventoryReport(report, format, queryString);
      toast.success(`Report exported`, `${format.toUpperCase()} generated.`);
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Export failed';
      toast.error('Export failed', msg);
    }
  }
  return { exportXlsx: () => run('xlsx'), exportPdf: () => run('pdf') };
}
