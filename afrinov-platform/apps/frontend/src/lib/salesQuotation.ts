// The quotation a client receives for an approved Sales RFQ, laid out like the
// Northam Platinum quotation (AFRI-02A-1469-04-1): the logo and date at the top,
// Our Reference and Your Reference, the client's name and address, QUOTATION:
// AFRI – 1469, "Dear <contact>", the one equipment line and Delivery with Total
// ex VAT, VAT and Total inc VAT, the Notes and Conditions, the Sales person who
// signs it, and the company's details at the foot of the page.
//
// The equipment's unit price is the Sales RFQ's labour and material with the
// markup (sales-costing.ts): the client never sees the costing. Until it is
// approved it is marked "Draft, not for issue", and a cancelled one "Cancelled",
// as orders are. The flame mark sits faint in the middle of every page, as on
// the example. Built in the browser like the order document; jsPDF loads only
// when a copy is asked for.
import { triggerDownload } from '../api/exportReport';
import { drawLogo, drawLogoWatermark, pdfText } from './pdf';
import { finishPages } from './poDocument';
import type { SalesRfq } from './salesRfq';

/** The wording Settings → Purchase orders has for quotations. */
export interface QuotationCompany { name: string; notes: string; letterhead: string }

/** The settings the document prints, for GET /settings/values. */
export const QUOTATION_SETTINGS = ['general.companyName', 'purchaseOrders.quotationNotes', 'purchaseOrders.quotationLetterhead'] as const;

export function quotationCompanyFromSettings(values: Record<string, unknown>): QuotationCompany {
  const s = (k: string) => (typeof values[k] === 'string' ? (values[k] as string).trim() : '');
  return { name: s('general.companyName') || 'Afrinov', notes: s('purchaseOrders.quotationNotes'), letterhead: s('purchaseOrders.quotationLetterhead') };
}

export function quotationStamp(status: string): string | null {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status !== 'APPROVED') return 'DRAFT - NOT FOR ISSUE';
  return null;
}

/** "R 154 866,25", as the quotation prints rand. */
export function quotationMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  const [whole, part] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}R ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${part}`;
}

/** "27 October 2026", as the example dates it: the calendar day kept, whatever the browser's timezone. */
export function quotationDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "QUOTATION: AFRI – 1469" for project AFRI-1469; the project number as it is otherwise. */
export function quotationHeading(projectNumber: string): string {
  const afrinov = /^AFRI-(\d+)$/.exec(projectNumber);
  return `QUOTATION: ${afrinov ? `AFRI – ${afrinov[1]}` : projectNumber}`;
}

/** "AFRI-02A-1469-04-1 Northam Platinum - Main Piston Pump.pdf", as the example is named. */
export function quotationFilename(r: Pick<SalesRfq, 'quoteReference' | 'number' | 'clientName' | 'equipment' | 'status'>): string {
  const safe = (v: string | null) => (v ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = [safe(r.clientName), safe(r.equipment)].filter(Boolean).join(' - ');
  const stamp = quotationStamp(r.status);
  return `${r.quoteReference ?? r.number}${name ? ` ${name}` : ''}${stamp === 'CANCELLED' ? ' - cancelled' : stamp ? ' - draft' : ''}.pdf`;
}

/** The table's rows: the equipment, then Delivery, as the example has them. */
export function quotationLines(r: Pick<SalesRfq, 'equipment' | 'totals'>): string[][] {
  const delivery = Number(r.totals.delivery);
  return [
    ['1', r.equipment ?? '-', '1', quotationMoney(r.totals.equipment), quotationMoney(r.totals.equipment)],
    ['2', 'Delivery', delivery > 0 ? '1' : '0', quotationMoney(delivery), delivery > 0 ? quotationMoney(delivery) : ''],
  ];
}

/** The numbered Conditions, each left off when blank. */
export function quotationConditions(r: Pick<SalesRfq, 'paymentTerms' | 'validity' | 'deliveryDuration' | 'deliveryTerms'>): string[] {
  return ([
    ['Payments terms', r.paymentTerms],
    ['Validity of Quotation', r.validity],
    ['Delivery duration', r.deliveryDuration],
    ['Delivery', r.deliveryTerms],
  ] as const).filter(([, v]) => v && v.trim()).map(([label, v]) => `${label}: ${v!.trim()}`);
}

const INK: [number, number, number] = [20, 20, 20];
const MUTED: [number, number, number] = [90, 99, 112];
const SIDE = 18;
const TOP = 14;
const BOTTOM = 14;

export async function buildQuotation(r: SalesRfq, company: QuotationCompany, generatedAt = new Date()): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - 2 * SIDE;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const text = (s: string, x: number, y: number, opts: { bold?: boolean; size?: number; italic?: boolean; align?: 'left' | 'right' | 'center'; color?: [number, number, number] } = {}) => {
    doc.setFont('helvetica', opts.bold && opts.italic ? 'bolditalic' : opts.bold ? 'bold' : opts.italic ? 'italic' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(...(opts.color ?? INK));
    doc.text(pdfText(s), x, y, opts.align ? { align: opts.align } : undefined);
  };

  // The flame mark faint in the middle of every page, as the Northam Platinum
  // quotation has it: drawn first on each page, so the text sits on top.
  const watermarked = new Set<number>();
  const watermark = () => {
    const page = doc.getCurrentPageInfo().pageNumber;
    if (watermarked.has(page)) return;
    watermarked.add(page);
    drawLogoWatermark(doc, pageWidth / 2, pageHeight / 2 + 10, 120);
  };
  watermark();

  // The logo top right, the date under it.
  drawLogo(doc, pageWidth - SIDE - 20, TOP - 4, 26);
  const date = quotationDate(r.issuedAt ?? generatedAt.toISOString());
  text(`DATE: ${date}`, pageWidth - SIDE, TOP + 32, { align: 'right' });

  let y = TOP + 40;
  text(`Our Reference: ${r.quoteReference ?? r.number}`, SIDE, y, { italic: true, size: 8 });
  text(`Your Reference: ${r.clientReference?.trim() || 'N/A'}`, pageWidth - SIDE, y, { italic: true, size: 8, align: 'right' });

  y += 7;
  text('CLIENT', SIDE + 2, y, { bold: true });
  doc.setDrawColor(...INK);
  doc.line(SIDE + 2, y + 0.8, SIDE + 2 + doc.getTextWidth('CLIENT'), y + 0.8);
  y += 6;
  const clientLines = [r.clientName ?? '', ...(r.clientAddress ?? '').split('\n')].map((l) => l.trim()).filter(Boolean);
  for (const line of clientLines) {
    for (const wrapped of doc.splitTextToSize(pdfText(line.toUpperCase()), width) as string[]) {
      text(wrapped, SIDE + 2, y);
      y += 5.5;
    }
  }

  y += 3;
  const heading = quotationHeading(r.projectNumber);
  text(heading, SIDE, y, { bold: true, size: 9 });
  doc.line(SIDE, y + 0.8, SIDE + doc.getTextWidth(pdfText(heading)), y + 0.8);
  y += 9;
  text(`Dear ${r.contactName?.trim() || 'Sir/Madam'},`, SIDE, y);
  y += 9;
  text('Thank you for allowing us to quote for the following equipment:', SIDE, y);

  const total = (label: string, value: string, bold = false) => [
    { content: pdfText(label), colSpan: 4, styles: { halign: 'right' as const, fontStyle: bold ? 'bold' as const : 'normal' as const } },
    { content: pdfText(value), styles: { fontStyle: bold ? 'bold' as const : 'normal' as const } },
  ];
  autoTable(doc, {
    startY: y + 1.5,
    margin: { left: SIDE, right: SIDE, top: TOP, bottom: BOTTOM + 20 },
    tableWidth: width,
    theme: 'grid',
    head: [['Item', 'Equipment Description', 'Qty', 'Unit Price', 'Total Price'].map(pdfText)],
    body: quotationLines(r).map((row) => row.map(pdfText)),
    foot: [
      total('Total Ex VAT', quotationMoney(r.totals.totalExVat), true),
      total(`${Number(r.totals.vatRate)}% VAT`, quotationMoney(r.totals.vat)),
      total('Total Inc VAT', quotationMoney(r.totals.totalIncVat)),
    ],
    showFoot: 'lastPage',
    // A table running onto another page gets the watermark there too, under it.
    willDrawPage: watermark,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.4, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: INK, overflow: 'linebreak' },
    headStyles: { fillColor: false, textColor: INK, fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: false, textColor: INK },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 30, halign: 'right' },
    },
  });
  y = finalY() + 8;

  const ensure = (needed: number) => { if (y + needed > pageHeight - BOTTOM - 20) { doc.addPage(); watermark(); y = TOP; } };
  if (company.notes) {
    ensure(14);
    text('Notes:', SIDE, y, { bold: true });
    y += 6;
    for (const line of doc.splitTextToSize(pdfText(company.notes), width) as string[]) {
      text(line, SIDE, y, { bold: true, italic: true });
      y += 5;
    }
    y += 4;
  }
  const conditions = quotationConditions(r);
  if (conditions.length) {
    ensure(14);
    text('Conditions:', SIDE, y, { bold: true });
    y += 6;
    conditions.forEach((c, i) => {
      const wrapped = doc.splitTextToSize(pdfText(c), width - 12) as string[];
      ensure(wrapped.length * 5);
      text(`${i + 1}.`, SIDE, y);
      wrapped.forEach((line, j) => text(line, SIDE + 12, y + j * 5));
      y += wrapped.length * 5 + 1;
    });
    y += 6;
  }

  ensure(34);
  text('Yours faithfully,', SIDE, y);
  y += 14;
  const signer = r.submittedBy?.name ?? r.createdBy?.name ?? '';
  if (signer) { text(signer, SIDE, y, { bold: true }); y += 6; }
  if (r.signerPhone) { text(`Contact: ${r.signerPhone}`, SIDE, y, { bold: true }); y += 6; }
  if (r.signerEmail) { text(`Email: ${r.signerEmail}`, SIDE, y, { bold: true }); y += 6; }

  // The company's details at the foot of every page, above the page number.
  const letterhead = company.letterhead.split('\n').map((l) => l.trim()).filter(Boolean);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    letterhead.forEach((line, i) => text(line, SIDE, pageHeight - BOTTOM - 4 - (letterhead.length - 1 - i) * 3.2, { size: 6.5, color: MUTED }));
  }

  finishPages(doc, quotationStamp(r.status), `${r.quoteReference ?? r.number} · ${company.name}`);
  return doc.output('arraybuffer');
}

export async function downloadQuotation(r: SalesRfq, company: QuotationCompany): Promise<void> {
  triggerDownload(new Blob([await buildQuotation(r, company)], { type: 'application/pdf' }), quotationFilename(r));
}
