// The request for quotation document (RFQ roadmap, Phase 3): what a supplier
// receives, laid out like the RFQ sheet of the Manhours and Material workbook.
// A4 portrait: the logo, REQUEST FOR QUOTATION and its number; who it is to
// beside the RFQ's own details (description, project, issued and closing
// dates); the lines with Item, Description, Units and Qty filled in and Unit
// price and Subtotal left for the supplier, with blank Total, VAT and Net
// value rows; then the instructions, where quotes go, and the remarks.
//
// One copy per supplier, each named after it. A draft is marked "Draft, not
// for issue" on every page and a cancelled RFQ "Cancelled", as orders are.
// Built in the browser like the order document, so it works in frontend-only
// mode too; jsPDF loads only when a copy is asked for.
import { triggerDownload } from '../api/exportReport';
import { drawLogo, pdfText } from './pdf';
import { finishPages } from './poDocument';
import { formatDate, formatNumber } from './format';
import { formatDay, type Rfq, type RfqSupplier } from './rfq';

/** Company details and the wording Settings → Purchase orders has for RFQs. */
export interface RfqCompany {
  name: string;
  instructions: string;
  quoteEmail: string;
}

/** The settings the document prints, for GET /settings/values. */
export const RFQ_DOCUMENT_SETTINGS = ['general.companyName', 'purchaseOrders.rfqInstructions', 'purchaseOrders.rfqQuoteEmail'] as const;

export function rfqCompanyFromSettings(values: Record<string, unknown>): RfqCompany {
  const s = (k: string) => (typeof values[k] === 'string' ? (values[k] as string).trim() : '');
  return { name: s('general.companyName') || 'Afrinov', instructions: s('purchaseOrders.rfqInstructions'), quoteEmail: s('purchaseOrders.rfqQuoteEmail') };
}

/** Marked across every page until the RFQ may go to suppliers, or once it is off. */
export function rfqDocumentStamp(status: string): string | null {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'DRAFT') return 'DRAFT - NOT FOR ISSUE';
  return null;
}

/** "AFRI-02A-1325-02-01 - EMV Africa.pdf", so each supplier's copy goes to the right email. */
export function rfqDocumentFilename(rfq: Pick<Rfq, 'number' | 'status'>, supplierName: string): string {
  const stamp = rfqDocumentStamp(rfq.status);
  const safe = supplierName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Supplier';
  return `${rfq.number} - ${safe}${stamp === 'CANCELLED' ? ' - cancelled' : stamp ? ' - draft' : ''}.pdf`;
}

type Pair = [string, string];
const dash = '-';
const or = (v: string | null | undefined) => (v && v.trim() ? v : dash);

/** Who it is to, and the RFQ's own details, as label and value pairs. */
export function rfqDocumentBlocks(rfq: Rfq, to: RfqSupplier, company: RfqCompany): { supplier: Pair[]; rfq: Pair[] } {
  const s = to.supplier;
  return {
    supplier: [
      ['Supplier', s?.name ?? to.supplierId],
      ['Vendor code', or(s?.vendorCode)],
      ['Contact person', or(s?.contactName)],
      ['Phone', or(s?.contactPhone)],
      ['Email', or(s?.contactEmail)],
      ['Address', or(s?.address)],
    ],
    rfq: [
      ['RFQ no.', rfq.number],
      ['Description', or(rfq.description)],
      ['Project', rfq.projectNumber ? rfq.projectNumber : 'Stores'],
      ['Issued', rfq.issuedAt ? formatDay(rfq.issuedAt) : dash],
      ['Closing', rfq.closingDate ? formatDay(rfq.closingDate) : dash],
      [`${company.name} contact`, or(rfq.sentBy?.name ?? rfq.createdBy?.name)],
      ['Currency', s?.currency ?? 'ZAR'],
      ['Penalties', rfq.penaltiesApply ? 'Penalties apply to this order' : 'No penalties applicable to this order'],
    ],
  };
}

/** The lines as the RFQ sheet numbers them, with Unit price and Subtotal left for the supplier. */
export function rfqDocumentLines(rfq: Pick<Rfq, 'lines'>): string[][] {
  return [...rfq.lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => [
      String(l.lineNo),
      l.material ? `${l.material.sku}  ${l.material.name}` : l.materialId,
      l.material?.unitOfMeasure ?? dash,
      formatNumber(Number(l.quantity)),
      '',
      '',
    ]);
}

/** Where and by when quotes go back; left off when Settings has no address. */
export function rfqReturnNote(rfq: Pick<Rfq, 'number' | 'closingDate'>, company: RfqCompany): string | null {
  if (!company.quoteEmail) return null;
  const by = rfq.closingDate ? ` by ${formatDay(rfq.closingDate)}` : '';
  return `Quotations to be returned to ${company.quoteEmail}${by}, quoting ${rfq.number}.`;
}

const INK: [number, number, number] = [33, 38, 46];
const MUTED: [number, number, number] = [90, 99, 112];
const RULE: [number, number, number] = [221, 225, 232];
const SIDE = 15;
const TOP = 12;
const BOTTOM = 14;

export async function buildRfqDocument(rfq: Rfq, to: RfqSupplier, company: RfqCompany, generatedAt = new Date()): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - 2 * SIDE;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const blocks = rfqDocumentBlocks(rfq, to, company);

  // Heading: the logo on the left, the RFQ number on the right, as on the sheet.
  drawLogo(doc, SIDE + 22, TOP - 2, 18);
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('REQUEST FOR QUOTATION', pageWidth - SIDE, TOP + 4, { align: 'right' });
  doc.setFontSize(12);
  doc.text(pdfText(rfq.number), pageWidth - SIDE, TOP + 11, { align: 'right' });

  // Who it is to on the left, the RFQ on the right.
  const half = (width - 6) / 2;
  const pairsTable = (title: string, pairs: Pair[], left: number) => {
    autoTable(doc, {
      startY: TOP + 24,
      margin: { left, right: pageWidth - left - half, top: TOP, bottom: BOTTOM + 6 },
      tableWidth: half,
      theme: 'plain',
      head: [[{ content: pdfText(title), colSpan: 2 }]],
      body: pairs.map(([k, v]) => [pdfText(k), pdfText(v)]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 }, textColor: INK, overflow: 'linebreak' },
      headStyles: { fontStyle: 'bold', fontSize: 8.5, fillColor: [243, 244, 246], textColor: INK },
      columnStyles: { 0: { cellWidth: 30, textColor: MUTED }, 1: { cellWidth: half - 30 } },
    });
    return finalY();
  };
  const leftY = pairsTable('To', blocks.supplier, SIDE);
  const rightY = pairsTable('Request for quotation', blocks.rfq, SIDE + half + 6);
  let y = Math.max(leftY, rightY) + 6;

  // The lines, with room to write a price, and the totals left blank under them.
  const blank = (label: string) => [{ content: pdfText(label), colSpan: 5, styles: { halign: 'right' as const } }, ''];
  autoTable(doc, {
    startY: y,
    margin: { left: SIDE, right: SIDE, top: TOP, bottom: BOTTOM + 6 },
    tableWidth: width,
    theme: 'grid',
    head: [['Item', 'Description', 'Units', 'Qty', 'Unit price', 'Subtotal'].map(pdfText)],
    body: rfqDocumentLines(rfq).map((r) => r.map(pdfText)),
    foot: [blank('Total amount (excl. VAT)'), blank('VAT'), blank('Net value')],
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, minCellHeight: 7, valign: 'middle', lineColor: RULE, lineWidth: 0.1, textColor: INK, overflow: 'linebreak' },
    headStyles: { fillColor: [52, 58, 69], textColor: 255, fontStyle: 'bold', minCellHeight: 0 },
    footStyles: { fillColor: [243, 244, 246], textColor: INK, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 11, halign: 'right' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 15 },
      3: { cellWidth: 18, halign: 'right' }, 4: { cellWidth: 27 }, 5: { cellWidth: 27 },
    },
    didParseCell: (data) => {
      // Headers line up with the figures under them.
      if (data.section === 'head' && [0, 3].includes(data.column.index)) data.cell.styles.halign = 'right';
    },
  });
  y = finalY() + 6;

  const ensure = (needed: number) => { if (y + needed > pageHeight - BOTTOM - 6) { doc.addPage(); y = TOP; } };
  const heading = (text: string) => {
    ensure(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(pdfText(text), SIDE, y + 3);
    y += 5;
  };
  const paragraph = (text: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    for (const line of doc.splitTextToSize(pdfText(text), width) as string[]) {
      ensure(5);
      doc.text(line, SIDE, y + 3);
      y += 4;
    }
    y += 2;
  };

  const returnNote = rfqReturnNote(rfq, company);
  if (company.instructions || returnNote) {
    heading('Instructions');
    if (company.instructions) paragraph(company.instructions);
    if (returnNote) paragraph(returnNote, true);
  }
  heading('Remarks');
  paragraph(or(rfq.notes));

  finishPages(doc, rfqDocumentStamp(rfq.status), `${rfq.number} · ${to.supplier?.name ?? to.supplierId} · ${company.name} · Printed ${formatDate(generatedAt.toISOString())}`);
  return doc.output('arraybuffer');
}

export async function downloadRfqDocument(rfq: Rfq, to: RfqSupplier, company: RfqCompany): Promise<void> {
  triggerDownload(new Blob([await buildRfqDocument(rfq, to, company)], { type: 'application/pdf' }), rfqDocumentFilename(rfq, to.supplier?.name ?? to.supplierId));
}
