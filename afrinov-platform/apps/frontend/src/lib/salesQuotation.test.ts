// The quotation to a client, as the Northam Platinum example lays it out, and
// the price the form shows while a Sales RFQ is typed.
import { describe, it, expect } from 'vitest';
import {
  buildQuotation, quotationCompanyFromSettings, quotationConditions, quotationDescription, quotationFilename, quotationHeading, quotationLines, quotationMoney, quotationNotes,
  quotationStamp,
} from './salesQuotation';
import { costingPreview, mayApprove, parseAmount, type SalesEquipmentLine, type SalesRfq } from './salesRfq';

const text = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(buf);

const pumpLine = (over: Partial<SalesEquipmentLine> = {}): SalesEquipmentLine => ({
  id: 'e-1', lineNo: 1, equipment: 'Main Piston Pump', details: null, quantity: 1, markupPercent: null, labour: [], materials: [], otherCosts: [],
  totals: { quantity: 1, markupPercent: '0', labour: '0.00', material: '154866.25', other: '0.00', unitCost: '154866.25', unitMarkup: '0.00', unitPrice: '154866.25', total: '154866.25' },
  ...over,
});

const rfq = (over: Partial<SalesRfq> = {}): SalesRfq => ({
  id: 'r-1', number: 'AFRI-02A-1469-02-01', quoteReference: 'AFRI-02A-1469-04-1', status: 'APPROVED', projectNumber: 'AFRI-1469',
  equipment: 'Main Piston Pump', equipmentLines: [pumpLine()], description: null, notes: null, quoteNotes: null, penaltiesApply: false, markupPercent: '0', deliveryPrice: '0', vatRate: '15',
  clientName: 'Northam Platinum', clientAddress: 'Main Office\nFarm Zondereinde 384KQ\nDistrict of Thabazimbi, South Africa', contactName: 'Bongi', clientReference: null,
  paymentTerms: '30 days from Invoice date.', validity: '30 days from issue of quotation.', deliveryDuration: '2 - 4 weeks from date of receiving official order', deliveryTerms: 'DAP, Northam Platinum',
  signerPhone: '+27 73 805 9123', signerEmail: 'Northamplats@afrinov.co.za', issuedAt: '2026-10-27T00:00:00.000Z', closingDate: null, createdAt: '2026-10-20T08:00:00.000Z',
  createdBy: { id: 'u-1', name: 'Ona Moloane' }, submittedAt: null, approvedAt: null, returnedAt: null, returnReason: null, cancelledAt: null, cancellationReason: null,
  totals: { labour: '0.00', material: '154866.25', other: '0.00', cost: '154866.25', markup: '0.00', equipment: '154866.25', delivery: '0.00', totalExVat: '154866.25', vatRate: '15', vat: '23229.94', totalIncVat: '178096.19' },
  ...over,
});

describe('the quotation', () => {
  it('prints rand as the example does', () => {
    expect(quotationMoney('154866.25')).toBe('R 154 866,25');
    expect(quotationMoney(0)).toBe('R 0,00');
    expect(quotationMoney(null)).toBe('-');
  });

  it('heads it with the project, and lists the equipment, then Delivery only when it is charged', () => {
    expect(quotationHeading('AFRI-1469')).toBe('QUOTATION: AFRI – 1469');
    expect(quotationHeading('P77')).toBe('QUOTATION: P77');
    expect(quotationLines(rfq())).toEqual([['1', 'Main Piston Pump', '1', 'R 154 866,25', 'R 154 866,25']]);
    const delivered = rfq({ totals: { ...rfq().totals, delivery: '1500.00' } });
    expect(quotationLines(delivered)[1]).toEqual(['2', 'Delivery', '1', 'R 1 500,00', 'R 1 500,00']);
  });

  it('lists each equipment line with what it covers under it, as AFRI-02A-1094-04-1 lists the door and its installation', () => {
    const door = pumpLine({
      equipment: 'Design, Manufacture & Supply Stainless Steel Ultra High Door & Rail:', details: '3D Scan Existing Area\n- Safety Installation Pack',
      totals: { ...pumpLine().totals, unitPrice: '167315.09', total: '167315.09' },
    });
    const installation = pumpLine({
      id: 'e-2', lineNo: 2, equipment: 'Installation:', details: 'Accomodation & LOA\nInstallation Labour', quantity: 2,
      totals: { ...pumpLine().totals, quantity: 2, unitPrice: '25394.30', total: '50788.60' },
    });
    expect(quotationDescription(door)).toBe('Design, Manufacture & Supply Stainless Steel Ultra High Door & Rail:\n- 3D Scan Existing Area\n- Safety Installation Pack');
    expect(quotationLines(rfq({ equipmentLines: [door, installation], totals: { ...rfq().totals, delivery: '250.00' } }))).toEqual([
      ['1', quotationDescription(door), '1', 'R 167 315,09', 'R 167 315,09'],
      ['2', 'Installation:\n- Accomodation & LOA\n- Installation Labour', '2', 'R 25 394,30', 'R 50 788,60'],
      ['3', 'Delivery', '1', 'R 250,00', 'R 250,00'],
    ]);
  });

  // AFRI-0413 Rev 2: the flexibles the client supplies are priced at quantity 0, "R -".
  it('prints a line at quantity 0 with its unit price and R -, charging nothing', () => {
    const flexibles = pumpLine({
      id: 'e-3', lineNo: 2, equipment: 'Electrode Flexibles per Furnace (Supplied to Client)', quantity: 0,
      totals: { ...pumpLine().totals, quantity: 0, unitPrice: '276660.56', total: '0.00' },
    });
    expect(quotationLines(rfq({ equipmentLines: [pumpLine(), flexibles] }))[1]).toEqual(['2', 'Electrode Flexibles per Furnace (Supplied to Client)', '0', 'R 276 660,56', 'R -']);
  });

  it("prints the company's Notes, then the quotation's own, one per line", () => {
    expect(quotationNotes('Orders to be made out to Afrinov (Pty) Ltd.', rfq({ quoteNotes: 'All Flexibles to be free issued by client\n\n Second note ' })))
      .toEqual(['Orders to be made out to Afrinov (Pty) Ltd.', 'All Flexibles to be free issued by client', 'Second note']);
    expect(quotationNotes('', rfq({ quoteNotes: 'Only this one' }))).toEqual(['Only this one']);
    expect(quotationNotes('', rfq())).toEqual([]);
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
    // The template's watermark, the official flame picture washed out (477 x 313),
    // under the official logo picture (468 x 421).
    expect(pdf).toMatch(/\/Width 477[\s\S]*\/Height 313/);
    expect(pdf).toMatch(/\/Width 468[\s\S]*\/Height 421/);
  });

  it("prints the quotation's own Notes under the company's", async () => {
    const pdf = text(await buildQuotation(rfq({ quoteNotes: 'All Flexibles to be free issued by client' }), { name: 'Afrinov', notes: 'Orders to be made out to Afrinov (Pty) Ltd.', letterhead: '' }));
    expect(pdf).toContain('Orders to be made out to Afrinov');
    expect(pdf).toContain('All Flexibles to be free issued by client');
    expect(pdf.indexOf('Orders to be made out to Afrinov')).toBeLessThan(pdf.indexOf('All Flexibles to be free issued by client'));
  });
});

describe('the price while it is typed', () => {
  it('works it out as the server does', () => {
    const pump = { quantity: 1, labour: [{ hours: 10, hourlyRate: 400 }, { hours: 5.5, hourlyRate: 300 }], materials: [9000], otherCosts: [] };
    expect(costingPreview({ lines: [pump], markupPercent: 40, deliveryPrice: 500, vatRate: 15 })).toEqual({
      labour: 5650, material: 9000, other: 0, cost: 14650, markup: 5860, equipment: 20510, totalExVat: 21010, vat: 3151.5, totalIncVat: 24161.5,
      lines: [{ markupPercent: 40, unitCost: 14650, unitPrice: 20510, total: 20510 }],
    });
    expect(costingPreview({ lines: [{ ...pump, labour: [], materials: [100] }], markupPercent: null, deliveryPrice: 0, vatRate: 15 }).equipment).toBeNull();
  });

  it('prices each line for one unit, rounds it, then multiplies by its quantity, as the server does', () => {
    // As sales-costing.test.ts: 1 000.01 × 33.33% = 333.30 a unit; 1 333.31 × 3.
    const p = costingPreview({
      lines: [
        { quantity: 3, labour: [], materials: [1000], otherCosts: [{ quantity: 1, unitCost: 0.01 }] },
        { quantity: 1, labour: [{ hours: 8, hourlyRate: 400 }], materials: [], otherCosts: [{ quantity: 2.5, unitCost: 350.5 }] },
      ],
      markupPercent: 33.33, deliveryPrice: 0, vatRate: 15,
    });
    expect(p.lines[0]).toEqual({ markupPercent: 33.33, unitCost: 1000.01, unitPrice: 1333.31, total: 3999.93 });
    // 3 200 + 876.25 = 4 076.25; × 33.33% = 1 358.61.
    expect(p.lines[1]).toEqual({ markupPercent: 33.33, unitCost: 4076.25, unitPrice: 5434.86, total: 5434.86 });
    // 999.90 + 1 358.61; and cost + markup = equipment.
    expect(p).toMatchObject({ material: 3000, other: 876.28, cost: 7076.28, markup: 2358.51, equipment: 9434.79 });
  });

  // AFRI-0413's costing sheet: the maintenance at 56%, the spares at 62%.
  it("prices each line at its own markup, or the job's, and only once every line has one, as the server does", () => {
    const lines = [
      { quantity: 1, labour: [], materials: [], otherCosts: [{ quantity: 1, unitCost: 255600 }] },
      { quantity: 1, markupPercent: 62, labour: [], materials: [], otherCosts: [{ quantity: 1, unitCost: 45000 }] },
    ];
    const p = costingPreview({ lines, markupPercent: 56, deliveryPrice: 0, vatRate: 15 });
    expect(p.lines.map((l) => [l.markupPercent, l.total])).toEqual([[56, 398736], [62, 72900]]);
    expect(p).toMatchObject({ totalExVat: 471636, vat: 70745.4, totalIncVat: 542381.4 });
    expect(costingPreview({ lines, markupPercent: null, deliveryPrice: 0, vatRate: 15 })).toMatchObject({ totalExVat: null, lines: [{ total: null }, { total: 72900 }] });
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
