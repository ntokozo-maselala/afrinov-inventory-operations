// The purchase order document: what the supplier receives, laid out like the
// Order sheet of the AFRI-0000_x template. A4 portrait: the logo and order
// number, the supplier and delivery details beside the order details, the
// lines with subtotal, VAT and net value, the order total, remarks, where to
// send invoices, the code of conduct, and the originator, authorization and
// supplier acceptance blocks. An order not yet approved is marked "Draft, not
// for issue" on every page, and a cancelled one "Cancelled".
//
// Built in the browser from the order as the server returns it, totals
// included, so the copy matches the screen; like the report PDFs it works in
// frontend-only mode too. jsPDF loads only when a copy is asked for.
import { triggerDownload } from '../api/exportReport';
import { drawLogo, pdfText } from './pdf';
import { formatDate, formatNumber } from './format';
import { formatMoney, formatRate, type PoTotals } from './poMoney';

export interface PoDocumentLine {
  material: { sku: string; name: string; unitOfMeasure: string };
  orderedQty: string;
  unitPrice?: string | null;
  subtotal?: string | null;
  vat?: string | null;
  net?: string | null;
  deliveryDate?: string | null;
}

export interface PoDocumentOrder {
  number: string;
  /** Raised each time the order is changed after approval. */
  revision?: number;
  status: string;
  createdAt: string;
  expectedDeliveryDate?: string | null;
  currency?: string;
  vatRate?: string;
  totals?: PoTotals;
  notes?: string | null;
  supplier: {
    name: string; vendorCode?: string | null; address?: string | null; contactName?: string | null;
    contactPhone?: string | null; contactEmail?: string | null;
  };
  /** The supplier's contact and address as on this order; left out by orders that don't carry them. */
  supplierContactName?: string | null;
  supplierContactPhone?: string | null;
  supplierContactEmail?: string | null;
  supplierAddress?: string | null;
  projectNumber?: string | null;
  paymentTerms?: string | null;
  paymentMilestone?: string | null;
  settlementDiscount?: string | number | null;
  shippingTerms?: string | null;
  penaltiesApply?: boolean;
  deliveryMethod?: string;
  deliveryTo?: string | null;
  deliveryAddress?: string | null;
  deliveryCountry?: string | null;
  deliveryContactName?: string | null;
  deliveryContactPhone?: string | null;
  afrinovContact?: string | null;
  createdBy?: { name: string } | null;
  approvedBy?: { name: string } | null;
  approvedAt?: string | null;
  /** The small print as it was when the order was approved; null before. */
  printedTerms?: Partial<PoSmallPrintWording> | null;
  lines: PoDocumentLine[];
}

/** The wording printed under Remarks, from Settings → Purchase orders. */
export interface PoSmallPrintWording {
  terms: string;
  latePenalty: string;
  documentation: string;
  invoicing: string;
  invoiceEmail: string;
  codeOfConduct: string;
}

/** Company details and the small print as Settings → Purchase orders has them now. */
export interface PoCompany extends PoSmallPrintWording {
  name: string;
  vatNumber: string;
}

/** The settings the document prints, for GET /settings/values. */
export const PO_DOCUMENT_SETTINGS = [
  'general.companyName', 'purchaseOrders.companyVatNumber', 'purchaseOrders.terms', 'purchaseOrders.latePenalty',
  'purchaseOrders.documentation', 'purchaseOrders.invoicing', 'purchaseOrders.invoiceEmail', 'purchaseOrders.codeOfConduct',
] as const;

export function companyFromSettings(values: Record<string, unknown>): PoCompany {
  const s = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : '');
  return {
    name: s('general.companyName') || 'Afrinov',
    vatNumber: s('purchaseOrders.companyVatNumber'),
    terms: s('purchaseOrders.terms'),
    latePenalty: s('purchaseOrders.latePenalty'),
    documentation: s('purchaseOrders.documentation'),
    invoicing: s('purchaseOrders.invoicing'),
    invoiceEmail: s('purchaseOrders.invoiceEmail'),
    codeOfConduct: s('purchaseOrders.codeOfConduct'),
  };
}

export interface SmallPrintSection { heading: string; paragraphs: Array<{ text: string; bold?: boolean }> }

/**
 * The sections under Remarks, as on the issued orders: Terms (ending with the
 * late delivery penalty in bold, only when penalties apply), Documentation,
 * Invoicing & Payment (ending with where invoices go), then the Code of
 * Conduct. An approved order prints the wording it was approved with; one not
 * yet approved, or approved before the wording was kept, prints today's.
 * A section with nothing in it is left off.
 */
export function smallPrint(po: Pick<PoDocumentOrder, 'number' | 'penaltiesApply' | 'printedTerms'>, company: PoCompany): SmallPrintSection[] {
  const kept = po.printedTerms;
  const wording = (k: keyof PoSmallPrintWording) => (kept ? kept[k] ?? '' : company[k]).trim();
  const sections: SmallPrintSection[] = [];
  // A section shows when its own wording is there; the penalty and where
  // invoices go only finish a section, so blanking its wording leaves it off.
  const add = (heading: string, main: string, extra: Array<{ text: string; bold?: boolean } | false> = []) => {
    if (!main) return;
    const more = extra.filter((p): p is { text: string; bold?: boolean } => !!p && !!p.text);
    sections.push({ heading, paragraphs: [{ text: main }, ...more] });
  };
  add('Terms', wording('terms'), [!!po.penaltiesApply && { text: wording('latePenalty'), bold: true }]);
  add('Documentation', wording('documentation'));
  const email = wording('invoiceEmail');
  add('Invoicing & Payment', wording('invoicing'), [!!email && { text: `Invoices to be submitted to: ${email}, quoting ${po.number}.`, bold: true }]);
  add('Code of Conduct', wording('codeOfConduct'));
  return sections;
}

/** Marked across every page until the order may go to the supplier. */
export function documentStamp(status: string): string | null {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'DRAFT' || status === 'PENDING_APPROVAL') return 'DRAFT - NOT FOR ISSUE';
  return null;
}

/** "Rev 00", "Rev 01", … as on the template. */
export function revisionLabel(revision: number | null | undefined): string {
  return `Rev ${String(revision ?? 0).padStart(2, '0')}`;
}

export function documentFilename(po: Pick<PoDocumentOrder, 'number' | 'status' | 'revision'>): string {
  const stamp = documentStamp(po.status);
  const rev = po.revision ? `-rev${String(po.revision).padStart(2, '0')}` : '';
  return `${po.number}${rev}${stamp === 'CANCELLED' ? '-cancelled' : stamp ? '-draft' : ''}.pdf`;
}

type Pair = [string, string];
const dash = '-';
const or = (v: string | null | undefined) => (v && v.trim() ? v : dash);
/** The order's own supplier detail (null when cleared), or the supplier's for an order that doesn't carry one. */
const onOrder = (own: string | null | undefined, supplier: string | null | undefined) => (own === undefined ? supplier : own);

/**
 * The supplier, delivery and order blocks as label and value pairs.
 * Supplier contact details and address fall back to the supplier only when
 * undefined on the order; null or blank values display as "-". Collection
 * shows contact details without a delivery address.
 */
export function documentBlocks(po: PoDocumentOrder, company: PoCompany): { supplier: Pair[]; delivery: Pair[]; order: Pair[] } {
  const collection = po.deliveryMethod === 'COLLECTION';
  return {
    supplier: [
      ['Supplier', po.supplier.name],
      ['Vendor code', or(po.supplier.vendorCode)],
      ['Address', or(onOrder(po.supplierAddress, po.supplier.address))],
      ['Contact person', or(onOrder(po.supplierContactName, po.supplier.contactName))],
      ['Phone', or(onOrder(po.supplierContactPhone, po.supplier.contactPhone))],
      ['Email', or(onOrder(po.supplierContactEmail, po.supplier.contactEmail))],
    ],
    delivery: collection
      ? [
        ['Delivery', 'Collection by Afrinov'],
        ['Contact person', or(po.deliveryContactName)],
        ['Phone', or(po.deliveryContactPhone)],
      ]
      : [
        ['Delivery to', or(po.deliveryTo)],
        ['Address', or([po.deliveryAddress, po.deliveryCountry].filter(Boolean).join('\n'))],
        ['Contact person', or(po.deliveryContactName)],
        ['Phone', or(po.deliveryContactPhone)],
      ],
    order: [
      ['Order date', formatDate(po.createdAt)],
      ['Payment terms', or(po.paymentTerms)],
      ['Payment milestone', or(po.paymentMilestone) === dash ? 'N/A' : po.paymentMilestone!],
      ['Settlement discount', formatRate(po.settlementDiscount ?? 0)],
      ['Currency', po.currency ?? 'ZAR'],
      [`${company.name} VAT no.`, or(company.vatNumber)],
      [`${company.name} contact`, or(po.afrinovContact)],
      ['Penalties', po.penaltiesApply ? 'Penalties apply to this order' : 'No penalties applicable to this order'],
      ['Project code', or(po.projectNumber)],
      ['Shipping terms', or(po.shippingTerms)],
    ],
  };
}

/** The lines table, numbered as on the template, with "-" where a line has no price. */
export function documentLines(po: PoDocumentOrder): string[][] {
  const currency = po.currency ?? 'ZAR';
  const money = (v: string | null | undefined) => (v === null || v === undefined ? dash : formatMoney(v, currency));
  return po.lines.map((l, i) => [
    String(i + 1),
    l.material.unitOfMeasure,
    `${l.material.sku}  ${l.material.name}`,
    money(l.unitPrice),
    formatNumber(Number(l.orderedQty)),
    l.deliveryDate ?? po.expectedDeliveryDate ? formatDate((l.deliveryDate ?? po.expectedDeliveryDate)!) : dash,
    money(l.subtotal),
    money(l.vat),
    money(l.net),
  ]);
}

const INK: [number, number, number] = [33, 38, 46];
const MUTED: [number, number, number] = [90, 99, 112];
const RULE: [number, number, number] = [221, 225, 232];
const SIDE = 15;
const TOP = 12;
const BOTTOM = 14;

export async function buildPoDocument(po: PoDocumentOrder, company: PoCompany, generatedAt = new Date()): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - 2 * SIDE;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const currency = po.currency ?? 'ZAR';
  const blocks = documentBlocks(po, company);

  // Heading: the logo on the left, the order number on the right, as on the Order sheet.
  drawLogo(doc, SIDE + 22, TOP - 2, 18);
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PURCHASE ORDER', pageWidth - SIDE, TOP + 4, { align: 'right' });
  doc.setFontSize(12);
  doc.text(pdfText(po.number), pageWidth - SIDE, TOP + 11, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(revisionLabel(po.revision), pageWidth - SIDE, TOP + 16, { align: 'right' });

  // Two columns of details: supplier and delivery on the left, the order on the right.
  const half = (width - 6) / 2;
  const pairsTable = (title: string, pairs: Pair[], startY: number, left: number) => {
    autoTable(doc, {
      startY,
      margin: { left, right: pageWidth - left - half, top: TOP, bottom: BOTTOM + 6 },
      tableWidth: half,
      theme: 'plain',
      head: [[{ content: pdfText(title), colSpan: 2 }]],
      body: pairs.map(([k, v]) => [pdfText(k), pdfText(v)]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 }, textColor: INK, overflow: 'linebreak' },
      headStyles: { fontStyle: 'bold', fontSize: 8.5, fillColor: [243, 244, 246], textColor: INK },
      columnStyles: { 0: { cellWidth: 32, textColor: MUTED }, 1: { cellWidth: half - 32 } },
    });
    return finalY();
  };
  const detailsTop = TOP + 24;
  let leftY = pairsTable('Supplier', blocks.supplier, detailsTop, SIDE);
  leftY = pairsTable(po.deliveryMethod === 'COLLECTION' ? 'Collection' : 'Delivery', blocks.delivery, leftY + 3, SIDE);
  const rightY = pairsTable('Order', blocks.order, detailsTop, SIDE + half + 6);
  let y = Math.max(leftY, rightY) + 6;

  // The lines, and the order total under them.
  const totals = po.totals;
  autoTable(doc, {
    startY: y,
    margin: { left: SIDE, right: SIDE, top: TOP, bottom: BOTTOM + 6 },
    tableWidth: width,
    theme: 'grid',
    head: [['Item', 'Units', 'Description', 'Unit price', 'Qty', 'Delivery', 'Subtotal', `VAT ${formatRate(po.vatRate ?? 0)}`, 'Net value'].map(pdfText)],
    body: documentLines(po).map((r) => r.map(pdfText)),
    foot: totals ? [[
      { content: pdfText(`Total amount of purchase order (${currency})`), colSpan: 6, styles: { halign: 'right' } },
      pdfText(formatMoney(totals.subtotal, currency)),
      pdfText(formatMoney(totals.vat, currency)),
      pdfText(formatMoney(totals.net, currency)),
    ]] : undefined,
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.3, lineColor: RULE, lineWidth: 0.1, textColor: INK, overflow: 'linebreak' },
    headStyles: { fillColor: [52, 58, 69], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [243, 244, 246], textColor: INK, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 9, halign: 'right' }, 1: { cellWidth: 12 }, 2: { cellWidth: 'auto' },
      3: { cellWidth: 20, halign: 'right' }, 4: { cellWidth: 11, halign: 'right' }, 5: { cellWidth: 18 },
      6: { cellWidth: 21, halign: 'right' }, 7: { cellWidth: 19, halign: 'right' }, 8: { cellWidth: 22, halign: 'right' },
    },
    didParseCell: (data) => {
      // Headers and totals line up with the figures under them.
      if (data.section !== 'body' && [0, 3, 4, 6, 7, 8].includes(data.column.index)) data.cell.styles.halign = 'right';
    },
  });
  y = finalY() + 5;

  const ensure = (needed: number) => { if (y + needed > pageHeight - BOTTOM - 6) { doc.addPage(); y = TOP; } };
  const heading = (text: string) => {
    ensure(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(pdfText(text), SIDE, y + 3);
    y += 5;
  };
  const paragraph = (text: string, size = 8, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    for (const line of doc.splitTextToSize(pdfText(text), width) as string[]) {
      ensure(5);
      doc.text(line, SIDE, y + 3);
      y += 4;
    }
    y += 2;
  };

  if (totals && totals.unpricedLines > 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(`${totals.unpricedLines} line${totals.unpricedLines === 1 ? ' has' : 's have'} no price and ${totals.unpricedLines === 1 ? 'is' : 'are'} not in the total.`), SIDE, y + 2);
    y += 6;
  }
  heading('Remarks');
  paragraph(or(po.notes));
  for (const section of smallPrint(po, company)) {
    heading(section.heading);
    for (const p of section.paragraphs) paragraph(p.text, section.heading === 'Code of Conduct' ? 7.5 : 8, p.bold);
  }

  // Originator, authorization and supplier acceptance, as at the foot of the Order sheet.
  ensure(34);
  y += 2;
  const third = (width - 8) / 3;
  const signature = (title: string, name: string, note: string, i: number) => {
    const x = SIDE + i * (third + 4);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.rect(x, y, third, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(pdfText(title), x + 2, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(pdfText(name), x + 2, y + 10);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(note), x + 2, y + 14.5);
    doc.line(x + 2, y + 22, x + third - 2, y + 22);
    doc.text('Signature and date', x + 2, y + 25);
  };
  signature('Originator', po.createdBy?.name ?? dash, formatDate(po.createdAt), 0);
  signature('Authorization', po.approvedBy?.name ?? 'Not yet approved', po.approvedAt ? `Approved ${formatDate(po.approvedAt)}` : '', 1);
  signature('Supplier acceptance', po.supplier.name, 'Name, signature and date', 2);

  // On every page: the stamp across it while the order may not go out, and the footer.
  const stamp = documentStamp(po.status);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (stamp) {
      // Faint, so the order stays readable under it, and centred on the page:
      // jsPDF turns text about its start, so start half its length back along the slope.
      const angle = 35;
      const rad = (angle * Math.PI) / 180;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(46);
      const half = doc.getTextWidth(stamp) / 2;
      const gs = doc as unknown as { GState: new (o: { opacity: number }) => unknown; setGState: (g: unknown) => void };
      doc.saveGraphicsState();
      gs.setGState(new gs.GState({ opacity: 0.18 }));
      if (stamp === 'CANCELLED') doc.setTextColor(200, 30, 30);
      else doc.setTextColor(...MUTED);
      doc.text(stamp, pageWidth / 2 - half * Math.cos(rad), pageHeight / 2 + half * Math.sin(rad), { angle });
      doc.restoreGraphicsState();
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(`${po.number} ${revisionLabel(po.revision)} · ${company.name} · Printed ${formatDate(generatedAt.toISOString())}`), SIDE, pageHeight - BOTTOM + 7);
    doc.text(`Page ${p} of ${pages}`, pageWidth - SIDE, pageHeight - BOTTOM + 7, { align: 'right' });
  }
  return doc.output('arraybuffer');
}

export async function downloadPoDocument(po: PoDocumentOrder, company: PoCompany): Promise<void> {
  triggerDownload(new Blob([await buildPoDocument(po, company)], { type: 'application/pdf' }), documentFilename(po));
}
