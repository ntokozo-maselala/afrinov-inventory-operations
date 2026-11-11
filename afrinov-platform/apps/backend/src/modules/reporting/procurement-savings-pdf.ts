// The Procurement savings report as a PDF: the page's totals, then one row per
// RFQ line with every supplier's price (the lowest in bold), the notes under the
// material, and a total row. A4 landscape, as the other report PDFs.
import PDFDocument from 'pdfkit';
import type { SavingsPrice, SavingsReport, SavingsRow } from './procurement-savings.service.js';

const MARGIN = 36;
const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = PAGE_HEIGHT - MARGIN - 12;
const PAD = 4;
const SIZE = 7;

const INK = '#0f172a';
const MUTED = '#64748b';
const NEGATIVE = '#b91c1c';
const NOTE = '#a16207';

/** One line of text in a cell. */
interface Run { text: string; bold?: boolean; color?: string; size?: number }
interface Column { header: string; weight: number; align: 'left' | 'right' }

const COLUMNS: Column[] = [
  { header: 'Project / RFQ', weight: 92, align: 'left' },
  { header: 'Material', weight: 140, align: 'left' },
  { header: 'Qty', weight: 36, align: 'right' },
  { header: 'Procurement RFQ prices', weight: 112, align: 'left' },
  { header: 'PO price', weight: 68, align: 'right' },
  { header: 'Line discount', weight: 48, align: 'right' },
  { header: 'Procurement vs PO', weight: 66, align: 'right' },
];
const TOTAL_WEIGHT = COLUMNS.reduce((sum, c) => sum + c.weight, 0);
const WIDTHS = COLUMNS.map((c) => (c.weight / TOTAL_WEIGHT) * CONTENT_WIDTH);

// en-ZA groups digits with a narrow no-break space Helvetica can't draw: a plain
// no-break space instead, so an amount is never split across two lines.
const NBSP = ' ';
const spaced = (s: string) => s.replace(/\s/g, NBSP);

/** "R 5 340,00", "-R 2 610,00", as the page shows rand; another currency by its code. */
function money(value: string | number, currency = 'ZAR'): string {
  const n = Number(value);
  const digits = spaced(Math.abs(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  return `${n < 0 ? '-' : ''}${currency === 'ZAR' ? 'R' : currency}${NBSP}${digits}`;
}
const qty = (value: string) => spaced(Number(value).toLocaleString('en-ZA', { maximumFractionDigits: 4 }));

function prices(list: SavingsPrice[] | undefined, lowest: string | null | undefined): Run[] {
  if (!list || list.length === 0) return [{ text: '—', color: MUTED }];
  const marked = list.findIndex((p) => p.lineTotal === lowest && p.currency === 'ZAR');
  return list.map((p, i) => ({ text: `${p.supplier}: ${money(p.lineTotal, p.currency)}`, bold: i === marked, color: i === marked ? INK : MUTED }));
}

function difference(value: string | null): Run[] {
  if (value === null) return [{ text: '—', color: MUTED }];
  return [{ text: money(value), color: Number(value) < 0 ? NEGATIVE : INK }];
}

function cells(r: SavingsRow): Run[][] {
  return [
    [
      { text: r.projectNumber ?? '—' },
      { text: `Procurement ${r.rfqNumber}`, color: MUTED },
    ],
    [
      { text: `${r.sku} ${r.material}` },
      ...r.notes.map((n) => ({ text: n, color: NOTE, size: 6 })),
    ],
    [{ text: `${qty(r.quantity)} ${r.unitOfMeasure}` }],
    prices(r.procurement.prices, r.procurement.lowest),
    r.order?.lineTotal
      ? [{ text: money(r.order.lineTotal, r.order.currency) }, { text: r.order.supplier, color: MUTED }]
      : [{ text: '—', color: MUTED }],
    r.order?.discount && Number(r.order.discount) > 0 ? [{ text: money(r.order.discount, r.order.currency) }] : [{ text: '—', color: MUTED }],
    difference(r.procurementVsOrder),
  ];
}

function useRun(doc: PDFKit.PDFDocument, run: Run): void {
  doc.font(run.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(run.size ?? SIZE);
}

function cellHeight(doc: PDFKit.PDFDocument, runs: Run[], width: number): number {
  return runs.reduce((h, run) => {
    useRun(doc, run);
    return h + doc.heightOfString(run.text, { width: width - PAD * 2 }) + 1;
  }, 0);
}

function drawRow(doc: PDFKit.PDFDocument, row: Run[][], options: { fill?: string } = {}): void {
  const height = Math.max(...row.map((runs, i) => cellHeight(doc, runs, WIDTHS[i]!))) + PAD * 2;
  if (doc.y + height > BOTTOM) {
    doc.addPage();
    drawTableHeader(doc);
  }
  const top = doc.y;
  if (options.fill) doc.rect(MARGIN, top, CONTENT_WIDTH, height).fill(options.fill);
  let x = MARGIN;
  row.forEach((runs, i) => {
    const width = WIDTHS[i]!;
    let y = top + PAD;
    for (const run of runs) {
      useRun(doc, run);
      doc.fillColor(run.color ?? INK).text(run.text, x + PAD, y, { width: width - PAD * 2, align: COLUMNS[i]!.align });
      y += doc.heightOfString(run.text, { width: width - PAD * 2 }) + 1;
    }
    x += width;
  });
  doc.moveTo(MARGIN, top + height).lineTo(MARGIN + CONTENT_WIDTH, top + height).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
  doc.y = top + height;
}

function drawTableHeader(doc: PDFKit.PDFDocument): void {
  drawRow(doc, COLUMNS.map((c) => [{ text: c.header.toUpperCase(), bold: true, color: '#475569', size: 6.5 }]), { fill: '#f1f5f9' });
}

function drawHeader(doc: PDFKit.PDFDocument, r: SavingsReport, scope: string, generatedAt: Date): void {
  doc.rect(0, 0, PAGE_WIDTH, 56).fill('#E3001B');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('Afrinov', MARGIN, 14);
  doc.font('Helvetica').fontSize(10).text('Procurement savings', MARGIN, 38);
  const right = { width: 260, align: 'right' as const };
  doc.fontSize(9);
  doc.text(`Period: ${r.from} to ${r.to}`, PAGE_WIDTH - MARGIN - 260, 14, right);
  doc.text(scope, PAGE_WIDTH - MARGIN - 260, 27, right);
  doc.text(`Generated ${generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`, PAGE_WIDTH - MARGIN - 260, 40, right);

  // How to read it, above the table rather than under it, where it could be left on a page of its own.
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(
    `What suppliers quoted the buyers, and what the order was placed at. Line totals excl. VAT, ${r.currency}; quotes at their lowest, the order before line discounts. `
    + 'RFQs count by the day they were sent. The lowest rand price is in bold. A difference is positive where the order is lower; '
    + 'one that can\'t be compared is blank and out of the totals, with the reason under the material.',
    MARGIN, 66, { width: CONTENT_WIDTH },
  );
  doc.y += 8;
}

function drawTotals(doc: PDFKit.PDFDocument, r: SavingsReport): void {
  const boxes: Array<[string, string]> = [
    ['Procurement vs PO', r.total.procurementVsOrder],
    ['Line discounts', r.total.discount],
  ];
  const width = CONTENT_WIDTH / boxes.length;
  const top = doc.y;
  boxes.forEach(([label, value], i) => {
    const x = MARGIN + i * width;
    doc.roundedRect(x + 3, top, width - 6, 40, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#475569').font('Helvetica').fontSize(7).text(label.toUpperCase(), x + 12, top + 8, { width: width - 24 });
    doc.fillColor(Number(value) < 0 ? NEGATIVE : INK).font('Helvetica-Bold').fontSize(13).text(money(value), x + 12, top + 20, { width: width - 24 });
  });
  doc.y = top + 52;
}

function drawFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Below the bottom margin, where pdfkit would otherwise start a new page.
    doc.page.margins.bottom = 0;
    const y = PAGE_HEIGHT - MARGIN / 2 - 6;
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
    doc.text('Afrinov IMS — Procurement savings', MARGIN, y, { width: CONTENT_WIDTH / 2, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + CONTENT_WIDTH / 2, y, { width: CONTENT_WIDTH / 2, align: 'right', lineBreak: false });
  }
}

export async function buildSavingsPdf(r: SavingsReport, meta: { scope: string; generatedAt?: Date }): Promise<Buffer> {
  const generatedAt = meta.generatedAt ?? new Date();
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true,
        info: { Title: `Procurement savings, ${r.from} to ${r.to}`, Author: 'Afrinov IMS', Subject: 'Procurement savings', CreationDate: generatedAt },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawHeader(doc, r, meta.scope, generatedAt);
      if (r.rows.length === 0) {
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Nothing to compare', MARGIN, doc.y);
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('No Procurement RFQ was sent for this selection in this period.');
      } else {
        drawTotals(doc, r);
        drawTableHeader(doc);
        r.rows.forEach((row, i) => drawRow(doc, cells(row), { fill: i % 2 === 1 ? '#fafafa' : undefined }));
        const t = r.total;
        const bold = (text: string, value?: string): Run[] => [{ text, bold: true, color: value !== undefined && Number(value) < 0 ? NEGATIVE : INK }];
        drawRow(doc, [
          bold(`Total (${t.lines} line${t.lines === 1 ? '' : 's'})`), [], [],
          bold(money(t.procurement)), bold(money(t.order)), bold(money(t.discount)),
          bold(money(t.procurementVsOrder), t.procurementVsOrder),
        ], { fill: '#f1f5f9' });
      }

      drawFooters(doc);
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
