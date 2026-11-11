// The quotation to a client, as the Northam Platinum example lays it out, and
// the price the form shows while a Sales RFQ is typed.
import { describe, it, expect } from 'vitest';
import {
  buildQuotation, quotationCompanyFromSettings, quotationConditions, quotationFilename, quotationHeading, quotationLines, quotationMoney, quotationStamp,
} from './salesQuotation';
import { costingPreview, mayApprove, parseAmount, type SalesRfq } from './salesRfq';

const text = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(buf);

const rfq = (over: Partial<SalesRfq> = {}): SalesRfq => ({
  id: 'r-1', number: 'AFRI-02A-1469-02-01', quoteReference: 'AFRI-02A-1469-04-1', status: 'APPROVED', projectNumber: 'AFRI-1469',
  equipment: 'Main Piston Pump', description: null, notes: null, penaltiesApply: false, markupPercent: '0', deliveryPrice: '0', vatRate: '15',
  clientName: 'Northam Platinum', clientAddress: 'Main Office\nFarm Zondereinde 384KQ\nDistrict of Thabazimbi, South Africa', contactName: 'Bongi', clientReference: null,
  paymentTerms: '30 days from Invoice date.', validity: '30 days from issue of quotation.', deliveryDuration: '2 - 4 weeks from date of receiving official order', deliveryTerms: 'DAP, Northam Platinum',
  signerPhone: '+27 73 805 9123', signerEmail: 'Northamplats@afrinov.co.za', issuedAt: '2026-10-27T00:00:00.000Z', closingDate: null, createdAt: '2026-10-20T08:00:00.000Z',
  createdBy: { id: 'u-1', name: 'Ona Moloane' }, submittedAt: null, approvedAt: null, returnedAt: null, returnReason: null, cancelledAt: null, cancellationReason: null,
  labour: [], materials: [],
  totals: { labour: '0.00', material: '154866.25', cost: '154866.25', markup: '0.00', equipment: '154866.25', delivery: '0.00', totalExVat: '154866.25', vatRate: '15', vat: '23229.94', totalIncVat: '178096.19' },
  ...over,
});

describe('the quotation', () => {
  it('prints rand as the example does', () => {
    expect(quotationMoney('154866.25')).toBe('R 154 866,25');
    expect(quotationMoney(0)).toBe('R 0,00');
    expect(quotationMoney(null)).toBe('-');
  });

  it('heads it with the project, and lists the equipment then Delivery', () => {
    expect(quotationHeading('AFRI-1469')).toBe('QUOTATION: AFRI – 1469');
    expect(quotationHeading('P77')).toBe('QUOTATION: P77');
    expect(quotationLines(rfq())).toEqual([
      ['1', 'Main Piston Pump', '1', 'R 154 866,25', 'R 154 866,25'],
      ['2', 'Delivery', '0', 'R 0,00', ''],
    ]);
    const delivered = rfq({ totals: { ...rfq().totals, delivery: '1500.00' } });
    expect(quotationLines(delivered)[1]).toEqual(['2', 'Delivery', '1', 'R 1 500,00', 'R 1 500,00']);
  });

  it('numbers the conditions, leaving out any left blank', () => {
    expect(quotationConditions(rfq({ validity: ' ' }))).toEqual([
      'Payments terms: 30 days from Invoice date.',
      'Delivery duration: 2 - 4 weeks from date of receiving official order',
      'Delivery: DAP, Northam Platinum',
    ]);
  });

  it('is named as the example is, and marked until it is approved', () => {
    expect(quotationFilename(rfq())).toBe('AFRI-02A-1469-04-1 Northam Platinum - Main Piston Pump.pdf');
    expect(quotationFilename(rfq({ status: 'DRAFT', quoteReference: null }))).toBe('AFRI-02A-1469-02-01 Northam Platinum - Main Piston Pump - draft.pdf');
    expect(quotationStamp('APPROVED')).toBeNull();
    expect(quotationStamp('PENDING_APPROVAL')).toBe('DRAFT - NOT FOR ISSUE');
    expect(quotationStamp('CANCELLED')).toBe('CANCELLED');
  });

  it('reads its wording from Settings', () => {
    expect(quotationCompanyFromSettings({ 'purchaseOrders.quotationNotes': ' Orders to Afrinov. ', 'purchaseOrders.quotationLetterhead': 'Line 1\nLine 2' }))
      .toEqual({ name: 'Afrinov', notes: 'Orders to Afrinov.', letterhead: 'Line 1\nLine 2' });
  });

  it('prints the references, the client, the prices, the conditions and who signs it', async () => {
    const pdf = text(await buildQuotation(rfq(), { name: 'Afrinov', notes: 'Orders to be made out to Afrinov (Pty) Ltd.', letterhead: 'Afrinov (Pty) Ltd\nVAT Registration No: 4010288142' }));
    expect(pdf.startsWith('%PDF')).toBe(true);
    for (const s of ['DATE: 27 October 2026', 'Our Reference: AFRI-02A-1469-04-1', 'Your Reference: N/A', 'NORTHAM PLATINUM', 'FARM ZONDEREINDE 384KQ', 'Dear Bongi,', 'Main Piston Pump',
      'R 154 866,25', 'R 23 229,94', 'R 178 096,19', 'Total Ex VAT', '15% VAT', 'Orders to be made out to Afrinov', 'Payments terms: 30 days from Invoice date.',
      'Ona Moloane', 'Contact: +27 73 805 9123', 'VAT Registration No: 4010288142']) {
      expect(pdf, s).toContain(s);
    }
    expect(pdf).not.toContain('NOT FOR ISSUE');
    // The faint flame mark in the middle of the page, as on the example.
    expect(pdf).toMatch(/\/ca 0\.15/);
  });
});

describe('the price while it is typed', () => {
  it('works it out as the server does', () => {
    expect(costingPreview({ labour: [{ hours: 10, hourlyRate: 400 }, { hours: 5.5, hourlyRate: 300 }], materials: [9000], markupPercent: 40, deliveryPrice: 500, vatRate: 15 }))
      .toEqual({ labour: 5650, material: 9000, cost: 14650, markup: 5860, equipment: 20510, totalExVat: 21010, vat: 3151.5, totalIncVat: 24161.5 });
    expect(costingPreview({ labour: [], materials: [100], markupPercent: null, deliveryPrice: 0, vatRate: 15 }).equipment).toBeNull();
  });

  it('reads an amount typed with a comma or a point', () => {
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount(' 1 500.25 ')).toBe(1500.25);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-3')).toBeNull();
  });

  it('lets only the Director approve, and never one they raised or submitted', () => {
    const waiting = { status: 'PENDING_APPROVAL' as const, createdById: 'u-sales', submittedById: 'u-sales' };
    expect(mayApprove(waiting, 'u-dir', true)).toBe(true);
    expect(mayApprove(waiting, 'u-sales', true)).toBe(false);
    expect(mayApprove(waiting, 'u-dir', false)).toBe(false);
    expect(mayApprove({ ...waiting, status: 'DRAFT' }, 'u-dir', true)).toBe(false);
  });
});
