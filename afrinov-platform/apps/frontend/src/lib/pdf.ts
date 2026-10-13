// The PDF copy of a report, for sending by email or filing: A4 landscape, the
// report's title and what it covers at the top, then its tables, each with its
// subtotal rows, and "Page X of Y" with when it was made at the foot of every
// page. Each table is as wide as its content, from the left margin; only one
// too wide for the page spans it, and then only its text columns wrap. Built in the browser from the same data the page shows, so live and
// frontend-only mode give the same file. jsPDF loads only when a PDF is asked for.
import { triggerDownload } from '../api/exportReport';
import { formatDateTime } from './format';

export interface PdfColumn {
  header: string;
  align?: 'left' | 'right';
  /**
   * Text that may wrap onto more lines when the table is wider than the page:
   * names, places and notes. Codes, dates, quantities and amounts never wrap.
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

const BRAND: [number, number, number] = [227, 0, 27];
const MUTED: [number, number, number] = [90, 99, 112];
/** Left and right: room to punch or bind a printed copy. */
const SIDE = 20;
/** Top and bottom. */
const MARGIN = 12;
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

export async function buildPdf(report: PdfReport, generatedAt = new Date()): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...BRAND);
  doc.text('AFRINOV IMS', SIDE, MARGIN + 2);
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text(pdfText(report.title), SIDE, MARGIN + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  let y = MARGIN + 16;
  for (const line of report.lines) {
    for (const wrapped of doc.splitTextToSize(pdfText(line), pageWidth - 2 * SIDE) as string[]) {
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
      for (const wrapped of doc.splitTextToSize(pdfText(section.note), pageWidth - 2 * SIDE) as string[]) {
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
    // How wide each column is with nothing wrapped: its widest cell, header and totals in bold.
    const measure = (s: string, bold: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(FONT_SIZE);
      return doc.getTextWidth(pdfText(s));
    };
    const natural = section.columns.map((c, i) => Math.max(
      measure(c.header, true),
      ...section.rows.map((r) => measure(r[i] ?? '', false)),
      ...(section.totals ?? []).map((r) => measure(r[i] ?? '', true)),
    ) + 2 * CELL_PADDING + 0.5);
    const contentWidth = natural.reduce((sum, w) => sum + w, 0);
    const fits = contentWidth <= pageWidth - 2 * SIDE;
    const columnStyles: Record<number, { halign: 'left' | 'right'; cellWidth: 'wrap' | 'auto' }> = {};
    section.columns.forEach((c, i) => { columnStyles[i] = { halign: c.align ?? 'left', cellWidth: c.wrap && !fits ? 'auto' : 'wrap' }; });
    autoTable(doc, {
      startY: y,
      margin: { left: SIDE, right: SIDE, top: MARGIN, bottom: MARGIN + 6 },
      tableWidth: fits ? contentWidth : 'auto',
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

export async function downloadPdf(report: PdfReport, filename: string): Promise<void> {
  triggerDownload(new Blob([await buildPdf(report)], { type: 'application/pdf' }), filename);
}
