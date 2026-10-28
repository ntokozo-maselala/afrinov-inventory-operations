// The purchase order document (procurement roadmap Phase 5), laid out like the
// Order sheet of the AFRI-0000_x template. Built, then read back as text: jsPDF
// writes its pages uncompressed.
import { describe, it, expect } from 'vitest';
import {
  buildPoDocument, companyFromSettings, documentBlocks, documentFilename, documentLines, documentStamp, revisionLabel, smallPrint, type PoDocumentOrder,
} from './poDocument';

const text = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(buf);
const COMPANY = {
  name: 'Afrinov', vatNumber: '4010288142',
  terms: 'Deliver by the order delivery date.', latePenalty: 'Late delivery incurs a penalty of 2% per week.',
  documentation: 'Provide material certificates.', invoicing: 'Payment may be withheld for missing documents.',
  invoiceEmail: 'accounts@afrinov.co.za', codeOfConduct: 'Suppliers declare any conflict of interest.',
};

const order = (over: Partial<PoDocumentOrder> = {}): PoDocumentOrder => ({
  number: 'PO-2026-0007', status: 'APPROVED', createdAt: '2026-10-19T08:00:00Z', expectedDeliveryDate: '2026-10-30',
  currency: 'ZAR', vatRate: '15', totals: { subtotal: '125.00', vat: '18.75', net: '143.75', unpricedLines: 1 },
  notes: 'Deliver to the boiler shop.',
  supplier: { name: 'Hydac', vendorCode: 'V006', address: 'Edenvale', contactName: 'Lillian', contactPhone: '011 723 9080', contactEmail: 'lillian@hydac.com' },
  projectNumber: 'M-1325', paymentTerms: '30 DAYS NETT', paymentMilestone: null, settlementDiscount: '2.5', shippingTerms: 'Delivered to site', penaltiesApply: true,
  deliveryMethod: 'DELIVERY', deliveryTo: 'Afrinov (PTY) Ltd', deliveryAddress: '10 Lime Street', deliveryCountry: 'South Africa',
  deliveryContactName: 'Site storeman', deliveryContactPhone: '011 000 0000', afrinovContact: 'Thandi Buyer',
  createdBy: { name: 'Thandi Buyer' }, approvedBy: { name: 'Approver Name' }, approvedAt: '2026-10-19T10:00:00Z',
  lines: [
    { material: { sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each' }, orderedQty: '10', unitPrice: '12.5', subtotal: '125.00', vat: '18.75', net: '143.75', deliveryDate: '2026-11-02' },
    { material: { sku: 'BOLT-M16', name: 'Hex bolt', unitOfMeasure: 'each' }, orderedQty: '4', unitPrice: null, subtotal: null, vat: null, net: null, deliveryDate: null },
  ],
  ...over,
});

describe('documentStamp and documentFilename', () => {
  it('marks an order not yet approved as a draft, and a cancelled one as cancelled', () => {
    expect(documentStamp('DRAFT')).toBe('DRAFT - NOT FOR ISSUE');
    expect(documentStamp('PENDING_APPROVAL')).toBe('DRAFT - NOT FOR ISSUE');
    expect(documentStamp('CANCELLED')).toBe('CANCELLED');
    for (const s of ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED']) expect(documentStamp(s)).toBeNull();
  });

  it('names the file after the order', () => {
    expect(documentFilename({ number: 'PO-2026-0007', status: 'APPROVED' })).toBe('PO-2026-0007.pdf');
    expect(documentFilename({ number: 'PO-2026-0007', status: 'DRAFT' })).toBe('PO-2026-0007-draft.pdf');
    expect(documentFilename({ number: 'PO-2026-0007', status: 'CANCELLED' })).toBe('PO-2026-0007-cancelled.pdf');
  });
});

describe('revisions', () => {
  it('labels the revision as the template does', () => {
    expect(revisionLabel(0)).toBe('Rev 00');
    expect(revisionLabel(undefined)).toBe('Rev 00');
    expect(revisionLabel(3)).toBe('Rev 03');
  });

  it('puts a revised order\'s revision in its file name', () => {
    expect(documentFilename({ number: 'AFRI-0412', status: 'APPROVED', revision: 0 })).toBe('AFRI-0412.pdf');
    expect(documentFilename({ number: 'AFRI-0412', status: 'APPROVED', revision: 2 })).toBe('AFRI-0412-rev02.pdf');
  });

  it('prints the revision under the order number and in the footer', async () => {
    const out = text(await buildPoDocument(order({ number: 'AFRI-0412', revision: 1 }), COMPANY));
    expect(out).toContain('Rev 01');
    expect(out).toContain('AFRI-0412 Rev 01');
  });
});

describe('documentBlocks', () => {
  it('carries the template fields: supplier, delivery and order details', () => {
    const b = documentBlocks(order(), COMPANY);
    expect(b.supplier).toContainEqual(['Vendor code', 'V006']);
    expect(b.delivery).toContainEqual(['Address', '10 Lime Street\nSouth Africa']);
    expect(Object.fromEntries(b.order)).toMatchObject({
      'Payment terms': '30 DAYS NETT', 'Payment milestone': 'N/A', 'Settlement discount': '2.5%', 'Afrinov VAT no.': '4010288142',
      'Afrinov contact': 'Thandi Buyer', Penalties: 'Penalties apply to this order', 'Project code': 'M-1325', 'Shipping terms': 'Delivered to site',
    });
  });

  it('prints the supplier details as on the order, and the supplier own for an order without them', () => {
    const own = documentBlocks(order({ supplierContactName: 'Sean', supplierContactPhone: null, supplierAddress: 'Branch 2' }), COMPANY);
    expect(Object.fromEntries(own.supplier)).toMatchObject({ 'Contact person': 'Sean', Phone: '-', Address: 'Branch 2', Email: 'lillian@hydac.com' });
    const before = documentBlocks(order(), COMPANY);
    expect(Object.fromEntries(before.supplier)).toMatchObject({ 'Contact person': 'Lillian', Phone: '011 723 9080', Address: 'Edenvale' });
  });

  it('prints a collection without a delivery address', () => {
    const b = documentBlocks(order({ deliveryMethod: 'COLLECTION' }), COMPANY);
    expect(b.delivery[0]).toEqual(['Delivery', 'Collection by Afrinov']);
    expect(b.delivery.some(([k]) => k === 'Address')).toBe(false);
  });

  it.each([null, '', '   '])('does not fall back to the supplier when order details were explicitly cleared (%j)', (value) => {
    const b = documentBlocks(order({ supplierContactName: value, supplierContactPhone: value, supplierContactEmail: value, supplierAddress: value }), COMPANY);
    expect(Object.fromEntries(b.supplier)).toEqual({
      Supplier: 'Hydac', 'Vendor code': 'V006', 'Contact person': '-', Phone: '-', Email: '-', Address: '-',
    });
    expect(b.delivery).toContainEqual(['Address', '10 Lime Street\nSouth Africa']);
  });

  it('falls back independently for each missing legacy field and handles a supplier without details', () => {
    const mixed = documentBlocks(order({ supplierContactEmail: 'orders@example.com', supplierAddress: null }), COMPANY);
    expect(Object.fromEntries(mixed.supplier)).toMatchObject({
      'Contact person': 'Lillian', Phone: '011 723 9080', Email: 'orders@example.com', Address: '-',
    });
    const missing = documentBlocks(order({ supplier: { name: 'New supplier' } }), COMPANY);
    expect(Object.fromEntries(missing.supplier)).toEqual({
      Supplier: 'New supplier', 'Vendor code': '-', 'Contact person': '-', Phone: '-', Email: '-', Address: '-',
    });
  });
});

describe('documentLines', () => {
  it('numbers the lines, falls back to the expected date, and shows "-" for a missing price', () => {
    const [first, second] = documentLines(order());
    expect(first!.slice(0, 3)).toEqual(['1', 'each', 'DISC-115  Cutting disc']);
    expect(first![8]).toMatch(/^R\s143,75$/);
    expect(second![3]).toBe('-');
    expect(second![5]).toBe(documentLines(order({ lines: [order().lines[1]!] }))[0]![5]);
    expect(second![5]).not.toBe('-');
  });
});

describe('buildPoDocument', () => {
  it('puts the saved supplier details in the PDF and leaves out the supplier master details', async () => {
    const out = text(await buildPoDocument(order({
      supplierContactName: 'Sean Buyer', supplierContactPhone: '060 970 5820', supplierContactEmail: 'branch@example.com', supplierAddress: 'Branch Depot\nRoodekop',
    }), COMPANY));
    for (const value of ['Sean Buyer', '060 970 5820', 'branch@example.com', 'Branch Depot', 'Roodekop']) expect(out).toContain(value);
    for (const value of ['Lillian', '011 723 9080', 'lillian@hydac.com', 'Edenvale']) expect(out).not.toContain(value);
  });

  it('keeps explicitly cleared supplier details out of the PDF', async () => {
    const out = text(await buildPoDocument(order({ supplierContactName: null, supplierContactPhone: null, supplierContactEmail: null, supplierAddress: null }), COMPANY));
    for (const value of ['Lillian', '011 723 9080', 'lillian@hydac.com', 'Edenvale']) expect(out).not.toContain(value);
    expect(out).toContain('Hydac');
    expect(out).toContain('V006');
  });

  it('prints the order as the template does', async () => {
    const out = text(await buildPoDocument(order(), COMPANY, new Date('2026-10-19T12:00:00Z')));
    expect(out.startsWith('%PDF-')).toBe(true);
    for (const s of [
      'PURCHASE ORDER', 'PO-2026-0007', 'Hydac', 'V006', 'Afrinov \\(PTY\\) Ltd', '30 DAYS NETT', '4010288142',
      'Penalties apply to this order', 'M-1325', 'Cutting disc', 'Total amount of purchase order \\(ZAR\\)',
      'Deliver to the boiler shop.', 'Terms', 'Deliver by the order delivery date.', 'Late delivery incurs a penalty',
      'Documentation', 'Provide material certificates.', 'Invoicing & Payment', 'Payment may be withheld',
      'Invoices to be submitted to: accounts@afrinov.co.za, quoting PO-2026-0007.', 'Code of Conduct',
      'Originator', 'Authorization', 'Approver Name', 'Supplier acceptance', '1 line has no price', 'Page 1 of 1',
    ]) expect(out, s).toContain(s);
    expect(out).not.toContain('NOT FOR ISSUE');
  });

  it('stamps a draft, and leaves the code of conduct off when there is none', async () => {
    const out = text(await buildPoDocument(order({ status: 'PENDING_APPROVAL', approvedBy: null, approvedAt: null }), { ...COMPANY, codeOfConduct: '' }));
    expect(out).toContain('DRAFT - NOT FOR ISSUE');
    expect(out).toContain('Not yet approved');
    expect(out).not.toContain('Code of Conduct');
  });

  it('runs onto more pages for a long order, totals on the last', async () => {
    const many = Array.from({ length: 80 }, () => order().lines[0]!);
    const out = text(await buildPoDocument(order({ lines: many }), COMPANY));
    expect(out).toMatch(/Page 1 of [2-9]/);
    expect(out.split('Total amount of purchase order').length - 1).toBe(1);
  });
});

describe('companyFromSettings', () => {
  it('reads the printed company details, with the name falling back to Afrinov', () => {
    expect(companyFromSettings({ 'purchaseOrders.companyVatNumber': '4010288142', 'purchaseOrders.terms': 'Deliver on time.' })).toEqual({
      name: 'Afrinov', vatNumber: '4010288142', terms: 'Deliver on time.', latePenalty: '', documentation: '', invoicing: '', invoiceEmail: '', codeOfConduct: '',
    });
  });
});

// Terms, Documentation, Invoicing & Payment and the Code of Conduct, as on the
// issued orders, under Remarks.
describe('smallPrint', () => {
  const headings = (s: ReturnType<typeof smallPrint>) => s.map((x) => x.heading);

  it('prints the sections in order, the late delivery penalty in bold at the end of Terms, and where invoices go', () => {
    const s = smallPrint({ number: 'AFRI-0412', penaltiesApply: true }, COMPANY);
    expect(headings(s)).toEqual(['Terms', 'Documentation', 'Invoicing & Payment', 'Code of Conduct']);
    expect(s[0]!.paragraphs).toEqual([{ text: COMPANY.terms }, { text: COMPANY.latePenalty, bold: true }]);
    expect(s[2]!.paragraphs.at(-1)).toEqual({ text: 'Invoices to be submitted to: accounts@afrinov.co.za, quoting AFRI-0412.', bold: true });
  });

  it('leaves the penalty off an order where penalties do not apply', () => {
    const s = smallPrint({ number: 'AFRI-0412', penaltiesApply: false }, COMPANY);
    expect(s[0]!.paragraphs).toEqual([{ text: COMPANY.terms }]);
  });

  it('leaves off a section with nothing in it', () => {
    const s = smallPrint({ number: 'AFRI-0412', penaltiesApply: false }, { ...COMPANY, documentation: '  ', codeOfConduct: '', terms: '' });
    expect(headings(s)).toEqual(['Invoicing & Payment']);
  });

  it('prints an approved order with the wording it was approved with, not today\'s', () => {
    const kept = { terms: 'Old terms.', latePenalty: 'Old penalty.', documentation: '', invoicing: 'Old invoicing.', invoiceEmail: 'old@afrinov.co.za', codeOfConduct: '' };
    const s = smallPrint({ number: 'AFRI-0412', penaltiesApply: true, printedTerms: kept }, COMPANY);
    expect(headings(s)).toEqual(['Terms', 'Invoicing & Payment']);
    expect(s[0]!.paragraphs.map((p) => p.text)).toEqual(['Old terms.', 'Old penalty.']);
    expect(s[1]!.paragraphs.at(-1)!.text).toContain('old@afrinov.co.za');
  });

  it('prints the PDF with the kept wording', async () => {
    const out = text(await buildPoDocument(order({ printedTerms: { terms: 'Terms as approved.', latePenalty: '', documentation: '', invoicing: '', invoiceEmail: '', codeOfConduct: '' } }), COMPANY));
    expect(out).toContain('Terms as approved.');
    expect(out).not.toContain('Deliver by the order delivery date.');
  });
});
