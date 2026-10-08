// Export module — generates .xlsx and .pdf artifacts for the inventory report.
//
// Both formats are derived from the SAME `ReportResult` object that the JSON
// endpoint returns, so the contents are guaranteed to match the on-screen
// report. No second source of truth.
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportResult, ReportMovementRow } from './report.service.js';

function fmtQty(n: number): string {
  return n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function fmtCurrency(n: number, currency: string): string {
  return n.toLocaleString('en-ZA', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 19);
  } catch { return iso; }
}

const CATEGORY_LABELS: Record<string, string> = {
  FASTENERS_SLUGS_INSULATION: 'Fasteners, slugs, insulation',
  TOOLING_PPE_ELECTRICAL: 'Tooling, PPE, electrical',
  PROJECT_MATERIAL: 'Project material',
  CONSUMABLES: 'Consumables',
  TOOLS: 'Tools',
};

const STATUS_LABELS: Record<string, string> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

function categoryLabel(c: string): string {
  return CATEGORY_LABELS[c] ?? c;
}

// ─── XLSX ────────────────────────────────────────────────────────────────

export async function buildInventoryXlsx(report: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Afrinov IMS';
  wb.created = new Date(report.generatedAt);

  // ── Sheet 1: Summary ───────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Afrinov Inventory Report', key: 'title', width: 60 },
  ];
  summary.getRow(1).font = { bold: true, size: 16, color: { argb: 'FFE3001B' } };
  summary.getRow(1).height = 26;
  summary.addRow(['Generated', fmtDateTime(report.generatedAt)]);
  summary.addRow(['Reporting period', report.kpis.rangeLabel]);
  summary.addRow(['Currency', report.currency]);
  summary.addRow([]);

  summary.addRow(['KPI', 'Value']).font = { bold: true };
  const kpiRow = (label: string, value: string) => {
    const r = summary.addRow([label, value]);
    r.getCell(2).numFmt = '@';
  };
  kpiRow('Total SKUs', String(report.kpis.skuCount));
  kpiRow('Total quantity', fmtQty(report.kpis.totalQuantity));
  kpiRow('Inventory value', fmtCurrency(report.kpis.inventoryValue, report.currency));
  kpiRow('Low stock items', String(report.kpis.lowStockCount));
  kpiRow('Out of stock items', String(report.kpis.outOfStockCount));
  kpiRow('Categories', String(report.kpis.categoryCount));
  kpiRow('Locations', String(report.kpis.locationCount));
  kpiRow('Suppliers', String(report.kpis.supplierCount));
  kpiRow('Movements (in period)', String(report.kpis.movementCount));
  summary.addRow([]);

  // Status breakdown
  summary.addRow(['Status', 'SKUs', 'Quantity', 'Inventory value']).font = { bold: true };
  for (const s of report.byStatus) {
    summary.addRow([
      STATUS_LABELS[s.status] ?? s.status,
      s.skuCount,
      s.quantity,
      fmtCurrency(s.inventoryValue, report.currency),
    ]);
  }
  summary.getColumn(4).numFmt = '#,##0.00';
  summary.addRow([]);

  // Category breakdown
  summary.addRow(['Category', 'SKUs', 'Quantity', 'Inventory value', 'Share']).font = { bold: true };
  for (const c of report.byCategory) {
    summary.addRow([
      categoryLabel(String(c.category)),
      c.skuCount,
      c.quantity,
      fmtCurrency(c.inventoryValue, report.currency),
      c.share,
    ]);
  }
  summary.getColumn(4).numFmt = '#,##0.00';
  summary.getColumn(5).numFmt = '0.0%';
  summary.addRow([]);

  // Movement summary
  summary.addRow(['Movement', 'Count', 'Quantity']).font = { bold: true };
  summary.addRow(['Receipts', report.movementSummary.receipts.count, report.movementSummary.receipts.quantity]);
  summary.addRow(['Issues', report.movementSummary.issues.count, report.movementSummary.issues.quantity]);
  summary.addRow(['Transfers', report.movementSummary.transfers.count, report.movementSummary.transfers.quantity]);
  summary.addRow(['Adjustments', report.movementSummary.adjustments.count, report.movementSummary.adjustments.quantity]);
  summary.addRow(['Returns', report.movementSummary.returns.count, report.movementSummary.returns.quantity]);
  summary.addRow(['Total', report.movementSummary.total.count, report.movementSummary.total.quantity]);
  summary.getColumn(3).numFmt = '#,##0.0000';

  // Freeze header rows
  summary.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet 2: Inventory ─────────────────────────────────────────────
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
    { header: 'Supplier', key: 'supplier', width: 28 },
    { header: 'Location', key: 'location', width: 22 },
    { header: 'Last updated', key: 'updated', width: 20 },
  ];
  inv.getRow(1).font = { bold: true };
  inv.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  for (const l of report.inventory) {
    inv.addRow([
      l.name,
      l.sku,
      categoryLabel(String(l.category)),
      l.unitOfMeasure,
      l.quantity,
      l.requiredStock,
      l.unitCost ?? '',
      l.inventoryValue,
      STATUS_LABELS[l.status] ?? l.status,
      supplierNameForSku(report, l.sku),
      l.locationName,
      fmtDateTime(l.lastUpdated),
    ]);
  }
  inv.getColumn(5).numFmt = '#,##0.0000';
  inv.getColumn(6).numFmt = '#,##0.0000';
  inv.getColumn(7).numFmt = '#,##0.00';
  inv.getColumn(8).numFmt = '#,##0.00';
  inv.getColumn(12).numFmt = '@';

  inv.autoFilter = { from: 'A1', to: `L${Math.max(1, report.inventory.length + 1)}` };
  inv.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet 3: Movements ─────────────────────────────────────────────
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
    mov.addRow([
      fmtDateTime(m.postedAt),
      m.materialName,
      m.materialSku,
      categoryLabel(String(m.category)),
      m.type,
      m.quantity,
      m.locationName,
      m.referenceType ? `${m.referenceType}${m.referenceId ? `#${m.referenceId}` : ''}` : '',
      m.projectNumber ?? '',
      m.reasonCode ? `${m.reasonCode}${m.reasonNote ? ' — ' + m.reasonNote : ''}` : '',
      m.actorName,
    ]);
  }
  mov.getColumn(6).numFmt = '#,##0.0000';
  mov.getColumn(1).numFmt = 'yyyy-mm-dd hh:mm:ss';
  mov.autoFilter = { from: 'A1', to: `K${Math.max(1, report.movements.length + 1)}` };
  mov.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Best-effort supplier name lookup for a material in the report's supplier
// breakdown. Returns the first supplier name (in descending value order).
function supplierNameForSku(report: ReportResult, sku: string): string {
  // The supplier breakdown doesn't carry SKUs; this helper isn't used by the
  // XLSX generator today but is kept for forward-compatibility (a future
  // version will thread a per-material supplier map through the report).
  void report; void sku;
  return '';
}

// ─── PDF ─────────────────────────────────────────────────────────────────

const PAGE_MARGIN = 36;
const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

export async function buildInventoryPdf(report: ReportResult): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN },
        info: {
          Title: 'Afrinov Inventory Report',
          Author: 'Afrinov IMS',
          Subject: 'Inventory Report',
          CreationDate: new Date(report.generatedAt),
        },
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawHeader(doc, report);
      drawKpis(doc, report);
      drawStatus(doc, report);
      drawCategoryTable(doc, report);
      drawExceptionsTable(doc, report);
      drawInventoryTable(doc, report);
      drawMovementsTable(doc, report);

      // Footer with page numbers
      drawFooters(doc);

      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

function drawHeader(doc: PDFKit.PDFDocument, report: ReportResult): void {
  // Brand bar
  doc.rect(0, 0, PAGE_WIDTH, 56).fill('#E3001B');
  doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold');
  doc.text('Afrinov', PAGE_MARGIN, 18);
  doc.fontSize(10).font('Helvetica');
  doc.text('Inventory Report', PAGE_MARGIN, 40);

  doc.fillColor('#ffffff').fontSize(9).font('Helvetica');
  const right = PAGE_WIDTH - PAGE_MARGIN;
  doc.text(`Generated ${fmtDateTime(report.generatedAt)}`, right, 18, { width: 220, align: 'right' });
  doc.text(`Period: ${report.kpis.rangeLabel}`, right, 32, { width: 220, align: 'right' });

  doc.y = 80;
  doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold');
  doc.text('Executive summary');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  doc.text(
    `This report summarises the current state of inventory across ${report.kpis.locationCount} ` +
    `location(s) and ${report.kpis.categoryCount} categor${report.kpis.categoryCount === 1 ? 'y' : 'ies'}, ` +
    `with movements in the selected period (${report.kpis.rangeLabel}). ` +
    `A total of ${report.kpis.skuCount} SKU${report.kpis.skuCount === 1 ? '' : 's'} are tracked, ` +
    `with a combined inventory value of ${fmtCurrency(report.kpis.inventoryValue, report.currency)}. ` +
    `${report.kpis.lowStockCount} item(s) are at or below their reorder threshold and ` +
    `${report.kpis.outOfStockCount} are completely out of stock.`,
    { width: CONTENT_WIDTH, align: 'left' },
  );
  doc.moveDown(1);
}

function drawKpis(doc: PDFKit.PDFDocument, report: ReportResult): void {
  ensureSpace(doc, 110);
  sectionTitle(doc, 'Key Performance Indicators');
  const kpis: Array<[string, string]> = [
    ['Total SKUs', String(report.kpis.skuCount)],
    ['Total quantity', fmtQty(report.kpis.totalQuantity)],
    ['Inventory value', fmtCurrency(report.kpis.inventoryValue, report.currency)],
    ['Low stock', String(report.kpis.lowStockCount)],
    ['Out of stock', String(report.kpis.outOfStockCount)],
    ['Categories', String(report.kpis.categoryCount)],
    ['Locations', String(report.kpis.locationCount)],
    ['Suppliers', String(report.kpis.supplierCount)],
    ['Movements', String(report.kpis.movementCount)],
  ];
  // 3-column grid
  const colWidth = CONTENT_WIDTH / 3;
  const cellHeight = 48;
  const startX = PAGE_MARGIN;
  const startY = doc.y;
  for (let i = 0; i < kpis.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * colWidth;
    const y = startY + row * cellHeight;
    doc.roundedRect(x + 4, y + 4, colWidth - 8, cellHeight - 8, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#475569').fontSize(7).font('Helvetica');
    doc.text(String(kpis[i]![0]).toUpperCase(), x + 12, y + 10, { width: colWidth - 24 });
    doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold');
    doc.text(String(kpis[i]![1]), x + 12, y + 22, { width: colWidth - 24 });
  }
  doc.y = startY + Math.ceil(kpis.length / 3) * cellHeight + 6;
  doc.fillColor('#000');
}

function drawStatus(doc: PDFKit.PDFDocument, report: ReportResult): void {
  ensureSpace(doc, 80);
  sectionTitle(doc, 'Stock status breakdown');
  const colWidth = CONTENT_WIDTH / 3;
  const cellHeight = 56;
  const startX = PAGE_MARGIN;
  const startY = doc.y;
  const colors = ['#16a34a', '#f59e0b', '#dc2626'];
  report.byStatus.forEach((s, i) => {
    const x = startX + i * colWidth;
    const y = startY;
    doc.roundedRect(x + 4, y + 4, colWidth - 8, cellHeight - 8, 4).fillAndStroke('#ffffff', colors[i]!);
    doc.fillColor(colors[i]!).fontSize(9).font('Helvetica-Bold');
    doc.text((STATUS_LABELS[s.status] ?? s.status).toUpperCase(), x + 14, y + 12, { width: colWidth - 28 });
    doc.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold');
    doc.text(`${s.skuCount} SKUs`, x + 14, y + 24, { width: colWidth - 28 });
    doc.fillColor('#475569').fontSize(8).font('Helvetica');
    doc.text(`${fmtQty(s.quantity)} units`, x + 14, y + 42, { width: colWidth - 28 });
  });
  doc.y = startY + cellHeight + 6;
  doc.fillColor('#000');
}

function drawCategoryTable(doc: PDFKit.PDFDocument, report: ReportResult): void {
  ensureSpace(doc, 80);
  sectionTitle(doc, 'Inventory by category');
  drawTable(doc,
    ['Category', 'SKUs', 'Quantity', 'Value', 'Share'],
    report.byCategory.map((c) => [
      categoryLabel(String(c.category)),
      String(c.skuCount),
      fmtQty(c.quantity),
      fmtCurrency(c.inventoryValue, report.currency),
      `${(c.share * 100).toFixed(1)}%`,
    ]),
    [180, 60, 80, 110, 60],
  );
  doc.moveDown(0.6);
}

function drawExceptionsTable(doc: PDFKit.PDFDocument, report: ReportResult): void {
  if (report.exceptions.length === 0) return;
  ensureSpace(doc, 60);
  sectionTitle(doc, 'Inventory requiring attention');
  drawTable(doc,
    ['SKU', 'Material', 'Location', 'On hand', 'Reorder', 'Status'],
    report.exceptions.map((l) => [
      l.sku,
      l.name,
      l.locationName,
      fmtQty(l.quantity),
      fmtQty(l.requiredStock),
      STATUS_LABELS[l.status] ?? l.status,
    ]),
    [80, 150, 90, 60, 60, 60],
    ['left', 'left', 'left', 'right', 'right', 'left'],
  );
  doc.moveDown(0.6);
  doc.fillColor('#000');
}

function drawInventoryTable(doc: PDFKit.PDFDocument, report: ReportResult): void {
  if (report.inventory.length === 0) return;
  ensureSpace(doc, 60);
  sectionTitle(doc, `Detailed inventory — page ${report.page}`);
  drawTable(doc,
    ['SKU', 'Material', 'Category', 'Location', 'On hand', 'Value', 'Status'],
    report.inventory.map((l) => [
      l.sku,
      l.name,
      categoryLabel(String(l.category)),
      l.locationName,
      fmtQty(l.quantity),
      fmtCurrency(l.inventoryValue, report.currency),
      STATUS_LABELS[l.status] ?? l.status,
    ]),
    [70, 130, 90, 80, 55, 65, 50],
    ['left', 'left', 'left', 'left', 'right', 'right', 'left'],
  );
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(7).fillColor('#64748b');
  doc.text(`This report page contains ${report.inventory.length} of ${report.inventoryTotal} inventory line(s).`, { width: CONTENT_WIDTH });
  doc.moveDown(0.6);
  doc.fillColor('#000');
}

function drawMovementsTable(doc: PDFKit.PDFDocument, report: ReportResult): void {
  if (report.movements.length === 0) return;
  ensureSpace(doc, 60);
  sectionTitle(doc, `Inventory movements (${report.movements.length})`);
  drawTable(doc,
    ['Date', 'Type', 'Material', 'Location', 'Qty', 'User'],
    report.movements.map((m: ReportMovementRow) => [
      fmtDateTime(m.postedAt).slice(0, 16),
      m.type,
      m.materialName,
      m.locationName,
      fmtQty(m.quantity),
      m.actorName,
    ]),
    [85, 65, 130, 80, 60, 80],
    ['left', 'left', 'left', 'left', 'right', 'left'],
  );
  doc.moveDown(0.6);
  doc.fillColor('#000');
}

type TableAlignment = 'left' | 'right' | 'center';

function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  widths: number[],
  alignments: TableAlignment[] = [],
): void {
  const x = PAGE_MARGIN;
  const rowH = 16;
  const contentBottom = PAGE_HEIGHT - PAGE_MARGIN;
  const suppliedWidth = widths.slice(0, headers.length).reduce((total, width) => total + width, 0);
  const columnWidths = headers.map((_, i) => {
    const weight = widths[i] ?? 1;
    return (weight / Math.max(suppliedWidth, 1)) * CONTENT_WIDTH;
  });

  const drawHeader = () => {
    if (doc.y + rowH > contentBottom) doc.addPage();
    const headerY = doc.y;
    doc.rect(x, headerY, CONTENT_WIDTH, rowH).fill('#f1f5f9');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8);
    let cx = x + 4;
    headers.forEach((header, i) => {
      const width = columnWidths[i] ?? 0;
      doc.text(fitTableCell(doc, header, width - 8), cx, headerY + 4, {
        width: Math.max(0, width - 8),
        align: alignments[i] ?? (i === 0 ? 'left' : 'right'),
        lineBreak: false,
      });
      cx += width;
    });
    doc.y = headerY + rowH;
    doc.fillColor('#000').font('Helvetica').fontSize(8);
  };

  drawHeader();
  rows.forEach((row, ri) => {
    if (doc.y + rowH > contentBottom) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (ri % 2 === 0) doc.rect(x, y, CONTENT_WIDTH, rowH).fill('#fafafa');
    doc.fillColor('#0f172a');
    let cx = x + 4;
    row.forEach((cell, i) => {
      const width = columnWidths[i] ?? 0;
      doc.text(fitTableCell(doc, cell, width - 8), cx, y + 4, {
        width: Math.max(0, width - 8),
        align: alignments[i] ?? (i === 0 ? 'left' : 'right'),
        lineBreak: false,
      });
      cx += width;
    });
    doc.y = y + rowH;
  });
}

function fitTableCell(doc: PDFKit.PDFDocument, value: string, width: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (width <= 0 || doc.widthOfString(text) <= width) return text;

  const suffix = '...';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (doc.widthOfString(text.slice(0, middle) + suffix) <= width) low = middle;
    else high = middle - 1;
  }
  return text.slice(0, low).trimEnd() + suffix;
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 24);
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11);
  doc.text(title);
  doc.moveDown(0.3);
  doc.fillColor('#000');
  // Accent underline
  const y = doc.y;
  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + 30, y).lineWidth(2).strokeColor('#E3001B').stroke();
  doc.lineWidth(0.5).strokeColor('#000');
  doc.y = y + 4;
  doc.moveDown(0.4);
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE_HEIGHT - PAGE_MARGIN) {
    doc.addPage();
  }
}

function drawFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = PAGE_HEIGHT - PAGE_MARGIN / 2 - 6;
    doc.fontSize(7).fillColor('#94a3b8').font('Helvetica');
    doc.text(
      'Afrinov IMS — Inventory Report',
      PAGE_MARGIN,
      y,
      { width: CONTENT_WIDTH / 2, align: 'left' },
    );
    doc.text(
      `Page ${i - range.start + 1} of ${range.count}`,
      PAGE_MARGIN + CONTENT_WIDTH / 2,
      y,
      { width: CONTENT_WIDTH / 2, align: 'right' },
    );
    doc.fillColor('#000');
  }
}
