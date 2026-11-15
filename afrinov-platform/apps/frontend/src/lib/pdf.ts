// The PDF copy of a report, for sending by email or filing: A4 landscape, the
// Afrinov logo centred at the top, then the report's title and what it covers,
// its tables, each with its subtotal rows, and "Page X of Y" with when it was
// made at the foot of every page. Every table spans the page, the spare width
// going to its text columns (names, places, notes), so the figures stay together
// on the right.
// Tables with the same columns share their column widths, so a report's
// per-category tables line up one under another. A table too wide for the page
// spans it, and then only its text columns wrap. Built in the browser from the
// same data the page shows, so live and frontend-only mode give the same file.
// jsPDF loads only when a PDF is asked for.
import { triggerDownload } from '../api/exportReport';
import type { jsPDF } from 'jspdf';
import { formatDateTime } from './format';
// Afrinov's official pictures, as its letterhead and quotation template carry
// them, embedded so a PDF needs nothing from the network.
import logoPng from '../assets/afrinov-logo.png?inline';
import watermarkJpeg from '../assets/afrinov-watermark.jpeg?inline';

export interface PdfColumn {
  header: string;
  align?: 'left' | 'right';
  /**
   * Text that may wrap onto more lines when the table is wider than the page,
   * and that takes the table's spare width: names, places and notes.
   * Codes, dates, quantities and amounts never wrap.
   */
  wrap?: boolean;
}

export interface PdfTable {
  heading?: string;
  /** A line under the heading, e.g. a count's note. */
  note?: string;
  columns: PdfColumn[];
  rows: string[][];
  /** Bold rows under the body: subtotals and totals. */
  totals?: string[][];
  /** Shown instead of the table when it has no rows. */
  empty?: string;
  /** Start on a new page, as a workbook starts a new sheet. */
  newPage?: boolean;
}

/** What a page says about the copy it asks for: its title and what it covers. */
export type PdfAbout = Pick<PdfReport, 'title' | 'lines'>;

export interface PdfReport {
  title: string;
  /** What the copy covers: the period, the filters, how figures are worked out. */
  lines: string[];
  sections: PdfTable[];
  /** Notes under the last table. */
  notes?: string[];
}

const MUTED: [number, number, number] = [90, 99, 112];
/** Left and right: room to punch or bind a printed copy. */
const SIDE = 20;
/** Top and bottom. */
const MARGIN = 12;
/** The logo's height at the top of the first page, in mm. */
const LOGO_HEIGHT = 24;
const FONT_SIZE = 8;
const CELL_PADDING = 1.5;

/**
 * The standard PDF fonts only carry Western European characters; swap the few
 * others the app's text and number formats use for ones that print.
 */
export function pdfText(s: string): string {
  return s
    .replace(/[\u202F\u2009\u2007]/g, ' ')
    .replace(/\u2212/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=');
}

/** Tables with the same column headers are the same kind of table, e.g. one per category. */
const signature = (table: PdfTable) => table.columns.map((c) => c.header).join('\u0000');
const sum = (ws: number[]) => ws.reduce((a, w) => a + w, 0);

export async function buildPdf(report: PdfReport, generatedAt = new Date()): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const available = pageWidth - 2 * SIDE;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // How wide each column is with nothing wrapped: its widest cell, header and totals in bold.
  const measure = (s: string, bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(FONT_SIZE);
    return doc.getTextWidth(pdfText(s));
  };
  const naturalWidths = (table: PdfTable) => table.columns.map((c, i) => Math.max(
    measure(c.header, true),
    ...table.rows.map((r) => measure(r[i] ?? '', false)),
    ...(table.totals ?? []).map((r) => measure(r[i] ?? '', true)),
  ) + 2 * CELL_PADDING + 0.5);
  // Tables of the same kind share the widest of their widths, so their columns line up.
  const shared = new Map<string, number[]>();
  for (const table of report.sections) {
    const widths = naturalWidths(table);
    const before = shared.get(signature(table));
    shared.set(signature(table), before ? before.map((w, i) => Math.max(w, widths[i] ?? 0)) : widths);
  }

  drawLogo(doc, pageWidth / 2, MARGIN - 2, LOGO_HEIGHT);
  const titleY = MARGIN - 2 + LOGO_HEIGHT + 9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text(pdfText(report.title), SIDE, titleY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  let y = titleY + 6;
  for (const line of report.lines) {
    for (const wrapped of doc.splitTextToSize(pdfText(line), available) as string[]) {
      doc.text(wrapped, SIDE, y);
      y += 4.5;
    }
  }
  y += 3;

  const footer = pdfText(`${report.title} · Generated ${formatDateTime(generatedAt.toISOString())}`);
  for (const section of report.sections) {
    // Keep a heading with at least the start of its table.
    if (y > pageHeight - 40 || (section.newPage && y > MARGIN)) { doc.addPage(); y = MARGIN; }
    if (section.heading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(20, 20, 20);
      doc.text(pdfText(section.heading), SIDE, y + 4);
      y += 7;
    }
    if (section.note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      for (const wrapped of doc.splitTextToSize(pdfText(section.note), available) as string[]) {
        doc.text(wrapped, SIDE, y + 2);
        y += 4.5;
      }
      y += 1;
    }
    if (section.rows.length === 0 && section.empty) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      doc.text(pdfText(section.empty), SIDE, y + 3);
      y += 10;
      continue;
    }
    const natural = shared.get(signature(section)) ?? naturalWidths(section);
    const contentWidth = sum(natural);
    const fits = contentWidth <= available;
    let widths: Array<number | 'auto' | 'wrap'>;
    if (!fits) {
      // Too wide for the page: it spans it, and only the text columns wrap.
      widths = section.columns.map((c) => (c.wrap ? 'auto' : 'wrap'));
    } else {
      // The table fills the page; the spare width goes to its text columns
      // (in proportion to their content), or to every column if it has none.
      const spare = available - contentWidth;
      const text = section.columns.flatMap((c, i) => (c.wrap ? [i] : []));
      const growing = new Set(text.length > 0 ? text : section.columns.map((_, i) => i));
      const growingWidth = sum(natural.filter((_, i) => growing.has(i)));
      widths = natural.map((w, i) => (growing.has(i) ? w + (spare * w) / growingWidth : w));
    }
    const columnStyles: Record<number, { halign: 'left' | 'right'; cellWidth: number | 'auto' | 'wrap' }> = {};
    section.columns.forEach((c, i) => { columnStyles[i] = { halign: c.align ?? 'left', cellWidth: widths[i] ?? 'auto' }; });
    autoTable(doc, {
      startY: y,
      margin: { left: SIDE, right: SIDE, top: MARGIN, bottom: MARGIN + 6 },
      tableWidth: !fits ? 'auto' : available,
      theme: 'grid',
      head: [section.columns.map((c) => pdfText(c.header))],
      body: [
        ...section.rows.map((r) => r.map(pdfText)),
        ...(section.totals ?? []).map((r) => r.map((cell) => ({ content: pdfText(cell), styles: { fontStyle: 'bold' as const, fillColor: [243, 244, 246] as [number, number, number] } }))),
      ],
      styles: { font: 'helvetica', fontSize: FONT_SIZE, cellPadding: CELL_PADDING, lineColor: [221, 225, 232], lineWidth: 0.1, textColor: [33, 38, 46], overflow: 'linebreak' },
      headStyles: { fillColor: [52, 58, 69], textColor: 255, fontStyle: 'bold' },
      columnStyles,
      didParseCell: (data) => {
        // Headers line up with their numbers.
        if (data.section === 'head') data.cell.styles.halign = section.columns[data.column.index]?.align ?? 'left';
      },
    });
    y = finalY() + 8;
  }

  if (report.notes?.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    for (const note of report.notes) {
      if (y > pageHeight - MARGIN - 8) { doc.addPage(); y = MARGIN; }
      doc.text(pdfText(note), SIDE, y);
      y += 4.5;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(footer, SIDE, pageHeight - MARGIN + 4);
    doc.text(`Page ${p} of ${pages}`, pageWidth - SIDE, pageHeight - MARGIN + 4, { align: 'right' });
  }
  return doc.output('arraybuffer');
}

/** Width over height of the logo picture (assets/afrinov-logo.png, 468 x 421). */
const LOGO_RATIO = 468 / 421;

/** The Afrinov logo, the official picture: centred on `centre`, its top at `y`, `height` mm tall. */
export function drawLogo(doc: jsPDF, centre: number, y: number, height: number) {
  const width = height * LOGO_RATIO;
  doc.addImage(logoPng, 'PNG', centre - width / 2, y, width, height, 'afrinov-logo', 'SLOW');
}

/**
 * The quotation template's watermark: the official flame picture, washed out as
 * Word shows it (gain 0.3, black level 0.35), at the template's 536.6 x 352.1 pt
 * (189.3 x 124.2 mm), centred on (`centreX`, `centreY`). The picture is the
 * whole of the template's, white around the flame, so the flame sits where it
 * does on the template. Drawn before a page's content, so the text sits on top.
 */
export const WATERMARK_SIZE = { width: 189.3, height: 124.2 } as const;
export function drawLogoWatermark(doc: jsPDF, centreX: number, centreY: number) {
  const { width, height } = WATERMARK_SIZE;
  doc.addImage(watermarkJpeg, 'JPEG', centreX - width / 2, centreY - height / 2, width, height, 'afrinov-watermark', 'SLOW');
}

export async function downloadPdf(report: PdfReport, filename: string): Promise<void> {
  triggerDownload(new Blob([await buildPdf(report)], { type: 'application/pdf' }), filename);
}
