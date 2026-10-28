// The request for quotation document (RFQ roadmap, Phase 3), laid out like the
// RFQ sheet of the Manhours and Material workbook. Built, then read back as
// text: jsPDF writes its pages uncompressed.
import { describe, it, expect } from 'vitest';
import {
  buildRfqDocument, rfqCompanyFromSettings, rfqDocumentBlocks, rfqDocumentFilename, rfqDocumentLines, rfqDocumentStamp, rfqReturnNote,
} from './rfqDocument';
import type { Rfq, RfqSupplier } from './rfq';
import { formatNumber } from './format';

const text = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(buf);
const COMPANY = {
  name: 'Afrinov',
  instructions: 'Fill in the UNIT PRICE and SUBTOTAL for each line as per the headings below, and save as PDF.',
  quoteEmail: 'quotes@afrinov.co.za',
};

const rfq = (over: Partial<Rfq> = {}): Rfq => ({
  id: 'r-1', number: 'AFRI-02A-1094-02-01', status: 'SENT', projectNumber: 'AFRI-1094', description: 'Supply ultrahigh door rails',
  notes: 'Stainless steel to 304 grade.', penaltiesApply: true, issuedAt: '2026-10-28T00:00:00.000Z', closingDate: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-10-28T08:00:00Z', createdBy: { id: 'u-1', name: 'Thandi Buyer' }, sentBy: { id: 'u-1', name: 'Thandi Buyer' },
  lines: [
    { id: 'l-2', lineNo: 2, materialId: 'm-2', quantity: '15.186', material: { sku: 'DOOR-SUP', name: 'Door overhead support', unitOfMeasure: 'LOTS' } },
    { id: 'l-1', lineNo: 1, materialId: 'm-1', quantity: '4.37', material: { sku: 'WHEEL-SS', name: 'Overhead rail wheel Stainless Steel', unitOfMeasure: 'LOTS' } },
  ],
  suppliers: [],
  ...over,
});
const TO: RfqSupplier = {
  supplierId: 's-1', quotedAt: null, declined: false,
  supplier: { id: 's-1', name: 'EMV Africa', vendorCode: 'V120', contactName: 'Sales desk', contactEmail: 'sales@emv.example', contactPhone: '011 000 0000', address: 'Germiston', currency: 'ZAR' },
};

describe('rfqDocumentStamp and rfqDocumentFilename', () => {
  it('marks a draft as not for issue and a cancelled RFQ as cancelled', () => {
    expect(rfqDocumentStamp('DRAFT')).toBe('DRAFT - NOT FOR ISSUE');
    expect(rfqDocumentStamp('CANCELLED')).toBe('CANCELLED');
    expect(rfqDocumentStamp('SENT')).toBeNull();
    expect(rfqDocumentStamp('AWARDED')).toBeNull();
  });

  it("names each copy after its RFQ and supplier, safe as a file name", () => {
    expect(rfqDocumentFilename(rfq(), 'EMV Africa')).toBe('AFRI-02A-1094-02-01 - EMV Africa.pdf');
    expect(rfqDocumentFilename(rfq({ status: 'DRAFT' }), 'A/B: Steel*')).toBe('AFRI-02A-1094-02-01 - A B Steel - draft.pdf');
    expect(rfqDocumentFilename(rfq({ status: 'CANCELLED' }), 'EMV Africa')).toBe('AFRI-02A-1094-02-01 - EMV Africa - cancelled.pdf');
  });
});

describe('rfqDocumentBlocks, rfqDocumentLines and rfqReturnNote', () => {
  it('puts who it is to beside the RFQ, as on the sheet', () => {
    const blocks = rfqDocumentBlocks(rfq(), TO, COMPANY);
    expect(blocks.supplier).toContainEqual(['Supplier', 'EMV Africa']);
    expect(blocks.supplier).toContainEqual(['Email', 'sales@emv.example']);
    expect(blocks.rfq).toContainEqual(['RFQ no.', 'AFRI-02A-1094-02-01']);
    expect(blocks.rfq).toContainEqual(['Description', 'Supply ultrahigh door rails']);
    expect(blocks.rfq).toContainEqual(['Issued', '28 Oct 2026']);
    expect(blocks.rfq).toContainEqual(['Closing', '01 Nov 2026']);
    expect(blocks.rfq).toContainEqual(['Afrinov contact', 'Thandi Buyer']);
    expect(blocks.rfq).toContainEqual(['Penalties', 'Penalties apply to this order']);
  });

  it('shows a dash for what a draft or a supplier lacks', () => {
    const blocks = rfqDocumentBlocks(rfq({ issuedAt: null, closingDate: null, projectNumber: null, sentBy: null }), { supplierId: 's-9', quotedAt: null, declined: false }, COMPANY);
    expect(blocks.supplier).toContainEqual(['Supplier', 's-9']);
    expect(blocks.supplier).toContainEqual(['Phone', '-']);
    expect(blocks.rfq).toContainEqual(['Project', 'Stores']);
    expect(blocks.rfq).toContainEqual(['Issued', '-']);
  });

  it('numbers the lines in order and leaves Unit price and Subtotal for the supplier', () => {
    // Quantities as the app shows them everywhere else.
    expect(rfqDocumentLines(rfq())).toEqual([
      ['1', 'WHEEL-SS  Overhead rail wheel Stainless Steel', 'LOTS', formatNumber(4.37), '', ''],
      ['2', 'DOOR-SUP  Door overhead support', 'LOTS', formatNumber(15.186), '', ''],
    ]);
  });

  it('says where and by when quotes go back, and nothing when Settings has no address', () => {
    expect(rfqReturnNote(rfq(), COMPANY)).toBe('Quotations to be returned to quotes@afrinov.co.za by 01 Nov 2026, quoting AFRI-02A-1094-02-01.');
    expect(rfqReturnNote(rfq(), { ...COMPANY, quoteEmail: '' })).toBeNull();
  });

  it('reads the wording from Settings, trimmed', () => {
    expect(rfqCompanyFromSettings({ 'general.companyName': 'Afrinov (Pty) Ltd', 'purchaseOrders.rfqInstructions': ' Quote in rand. ', 'purchaseOrders.rfqQuoteEmail': '' }))
      .toEqual({ name: 'Afrinov (Pty) Ltd', instructions: 'Quote in rand.', quoteEmail: '' });
  });
});

describe('buildRfqDocument', () => {
  it('prints the heading, both blocks, the lines with blank totals, the instructions and the remarks', async () => {
    const pdf = text(await buildRfqDocument(rfq(), TO, COMPANY, new Date('2026-10-28T09:00:00Z')));
    for (const s of [
      'REQUEST FOR QUOTATION', 'AFRI-02A-1094-02-01', 'EMV Africa', 'Supply ultrahigh door rails',
      'Unit price', 'Subtotal', 'Total amount \\(excl. VAT\\)', 'Net value', 'Overhead rail wheel Stainless Steel',
      'Instructions', 'save as PDF', 'quotes@afrinov.co.za', 'Remarks', 'Stainless steel to 304 grade.',
    ]) expect(pdf).toContain(s);
    expect(pdf).not.toContain('DRAFT - NOT FOR ISSUE');
  });

  it('stamps a draft, and leaves Instructions off when Settings has none', async () => {
    const pdf = text(await buildRfqDocument(rfq({ status: 'DRAFT', notes: null }), TO, { ...COMPANY, instructions: '', quoteEmail: '' }));
    expect(pdf).toContain('DRAFT - NOT FOR ISSUE');
    expect(pdf).not.toContain('Instructions');
  });
});
