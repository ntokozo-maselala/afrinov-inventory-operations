// The PDF copy of a report, for sending by email or filing: A4 landscape, the
// report's title and what it covers at the top, then its tables, each with its
// subtotal rows, and "Page X of Y" with when it was made at the foot of every
// page. Built in the browser from the same data the page shows, so live and
// frontend-only mode give the same file. jsPDF loads only when a PDF is asked for.
import { triggerDownload } from '../api/exportReport';
import { formatDateTime } from './format';

export interface PdfColumn {
  header: string;
  align?: 'left' | 'right';
  /** Width in millimetres; columns without one share what is left. */
  width?: number;
}

export interface PdfTable {
  heading?: string;
  columns: PdfColumn[];
  rows: string[][];
  /** Bold rows under the body: subtotals and totals. */
  totals?: string[][];
  /** Shown instead of the table when it has no rows. */
  empty?: string;
}

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
const MARGIN = 12;

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
  doc.text('AFRINOV IMS', MARGIN, MARGIN + 2);
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text(pdfText(report.title), MARGIN, MARGIN + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  let y = MARGIN + 16;
  for (const line of report.lines) {
    for (const wrapped of doc.splitTextToSize(pdfText(line), pageWidth - 2 * MARGIN) as string[]) {
      doc.text(wrapped, MARGIN, y);
      y += 4.5;
    }
  }
  y += 3;

  const footer = pdfText(`${report.title} · Generated ${formatDateTime(generatedAt.toISOString())}`);
  for (const section of report.sections) {
    // Keep a heading with at least the start of its table.
    if (y > pageHeight - 40) { doc.addPage(); y = MARGIN; }
    if (section.heading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(20, 20, 20);
      doc.text(pdfText(section.heading), MARGIN, y + 4);
      y += 7;
    }
    if (section.rows.length === 0 && section.empty) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      doc.text(pdfText(section.empty), MARGIN, y + 3);
      y += 10;
      continue;
    }
    const columnStyles: Record<number, { halign?: 'left' | 'right'; cellWidth?: number }> = {};
    section.columns.forEach((c, i) => { columnStyles[i] = { halign: c.align ?? 'left', ...(c.width ? { cellWidth: c.width } : {}) }; });
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 6 },
      theme: 'grid',
      head: [section.columns.map((c) => pdfText(c.header))],
      body: [
        ...section.rows.map((r) => r.map(pdfText)),
        ...(section.totals ?? []).map((r) => r.map((cell) => ({ content: pdfText(cell), styles: { fontStyle: 'bold' as const, fillColor: [243, 244, 246] as [number, number, number] } }))),
      ],
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, lineColor: [221, 225, 232], lineWidth: 0.1, textColor: [33, 38, 46], overflow: 'linebreak' },
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
      doc.text(pdfText(note), MARGIN, y);
      y += 4.5;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(footer, MARGIN, pageHeight - MARGIN + 4);
    doc.text(`Page ${p} of ${pages}`, pageWidth - MARGIN, pageHeight - MARGIN + 4, { align: 'right' });
  }
  return doc.output('arraybuffer');
}

export async function downloadPdf(report: PdfReport, filename: string): Promise<void> {
  triggerDownload(new Blob([await buildPdf(report)], { type: 'application/pdf' }), filename);
}
