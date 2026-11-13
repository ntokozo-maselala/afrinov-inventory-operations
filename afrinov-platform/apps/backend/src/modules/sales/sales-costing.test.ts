// The Sales RFQ's money: each equipment line's labour, material and other costs
// for one unit, the markup on them, times the line's quantity; delivery after
// the lines, and VAT last; a Procurement quote's value; quotation references.
import { describe, it, expect } from 'vitest';
import { costingTotals, labourLineTotal, lineTotals, nextQuoteReference, otherCostTotal, quoteValue, type CostingLine } from './sales-costing.js';

const line = (over: Partial<CostingLine> = {}): CostingLine => ({ quantity: 1, labour: [], materials: [], otherCosts: [], ...over });

describe('Sales RFQ costing', () => {
  it('puts the markup on labour and material together, and delivery after it, as the quotation shows', () => {
    const t = costingTotals({
      lines: [line({ labour: [{ hours: 10, hourlyRate: 400 }, { hours: 5.5, hourlyRate: 300 }], materials: ['9000.00'] })],
      markupPercent: 40,
      deliveryPrice: 500,
      vatRate: 15,
    });
    expect(t).toEqual({
      labour: '5650.00', material: '9000.00', other: '0.00', cost: '14650.00', markup: '5860.00', equipment: '20510.00', delivery: '500.00',
      totalExVat: '21010.00', vatRate: '15', vat: '3151.50', totalIncVat: '24161.50',
      lines: [{ quantity: 1, markupPercent: '40', labour: '5650.00', material: '9000.00', other: '0.00', unitCost: '14650.00', unitMarkup: '5860.00', unitPrice: '20510.00', total: '20510.00' }],
    });
  });

  it('gives the cost but nothing marked up until there is a markup', () => {
    const t = costingTotals({ lines: [line({ labour: [{ hours: 1, hourlyRate: 150 }] })], markupPercent: null, deliveryPrice: 0, vatRate: 15 });
    expect(t).toMatchObject({ cost: '150.00', markup: null, equipment: null, totalExVat: null, vat: null, totalIncVat: null });
    expect(t.lines[0]).toMatchObject({ unitCost: '150.00', unitMarkup: null, unitPrice: null, total: null });
  });

  it('rounds each step to cents, half up', () => {
    expect(labourLineTotal({ hours: 0.33, hourlyRate: 250 })).toBe('82.50');
    expect(otherCostTotal({ quantity: 2.5, unitCost: 333.33 })).toBe('833.33');
    const t = costingTotals({ lines: [line({ materials: ['100.01'] })], markupPercent: 12.5, deliveryPrice: 0, vatRate: 15 });
    // 100.01 × 12.5% = 12.50125 → 12.50; 112.51 × 15% = 16.8765 → 16.88.
    expect(t).toMatchObject({ markup: '12.50', equipment: '112.51', vat: '16.88', totalIncVat: '129.39' });
  });

  // AFRI-0413 Rev 2: lines 3 and 4 show their price at quantity 0, charging nothing.
  it('prices a line of quantity 0 for the client to see, adding nothing to the totals', () => {
    const t = costingTotals({
      lines: [line({ otherCosts: [{ quantity: 1, unitCost: 1000 }] }), line({ quantity: 0, otherCosts: [{ quantity: 1, unitCost: 100080.27 }] })],
      markupPercent: 50, deliveryPrice: 0, vatRate: 15,
    });
    expect(t.lines[1]).toEqual({
      quantity: 0, markupPercent: '50', labour: '0.00', material: '0.00', other: '100080.27', unitCost: '100080.27', unitMarkup: '50040.14', unitPrice: '150120.41', total: '0.00',
    });
    expect(t).toMatchObject({ other: '1000.00', cost: '1000.00', markup: '500.00', equipment: '1500.00', totalExVat: '1500.00', vat: '225.00', totalIncVat: '1725.00' });
  });

  // AFRI-0413's costing sheet: the maintenance × 1.3 × 1.2 (56%), the spares
  // × 1.35 × 1.2 (62%), the hydraulic flexibles × 1.3 × 1.2, not charged.
  it('marks each line up at its own markup, or the job\'s when it has none, as AFRI-0413 Rev 2', () => {
    const t = costingTotals({
      lines: [
        line({ otherCosts: [{ quantity: 1, unitCost: 255600 }] }),
        line({ markupPercent: 62, otherCosts: [{ quantity: 1, unitCost: 45000 }] }),
        line({ quantity: 0, otherCosts: [{ quantity: 1, unitCost: 46870 }] }),
      ],
      markupPercent: 56, deliveryPrice: 0, vatRate: 15,
    });
    expect(t.lines.map((l) => [l.markupPercent, l.unitPrice, l.total])).toEqual([['56', '398736.00', '398736.00'], ['62', '72900.00', '72900.00'], ['56', '73117.20', '0.00']]);
    expect(t).toMatchObject({ cost: '300600.00', markup: '171036.00', equipment: '471636.00', totalExVat: '471636.00', vat: '70745.40', totalIncVat: '542381.40' });
  });

  it('prices the quotation only once every line has a markup, its own or the job\'s', () => {
    const t = costingTotals({ lines: [line({ markupPercent: 10, otherCosts: [{ quantity: 1, unitCost: 100 }] }), line({ otherCosts: [{ quantity: 1, unitCost: 50 }] })], markupPercent: null, deliveryPrice: 0, vatRate: 15 });
    expect(t.lines.map((l) => l.unitPrice)).toEqual(['110.00', null]);
    expect(t).toMatchObject({ cost: '150.00', markup: null, equipment: null, totalExVat: null });
    const own = costingTotals({ lines: [line({ markupPercent: 10, otherCosts: [{ quantity: 1, unitCost: 100 }] })], markupPercent: null, deliveryPrice: 0, vatRate: 15 });
    expect(own).toMatchObject({ markup: '10.00', totalExVat: '110.00' });
  });

  it('matches the Northam Platinum quotation from its equipment price', () => {
    const t = costingTotals({ lines: [line({ materials: ['154866.25'] })], markupPercent: 0, deliveryPrice: 0, vatRate: 15 });
    expect(t).toMatchObject({ totalExVat: '154866.25', vat: '23229.94', totalIncVat: '178096.19' });
  });

  it('prices each equipment line on its own and adds them up, as AFRI-02A-1094-04-1 has the door and its installation', () => {
    const t = costingTotals({
      lines: [
        line({ materials: ['167315.09'] }),
        // Installation: 4 nights at R1 200, 4 days' LOA at R350, and the fitters' hours.
        line({ labour: [{ hours: 40, hourlyRate: 1100.47 }], otherCosts: [{ quantity: 4, unitCost: 1200 }, { quantity: 4, unitCost: 350 }] }),
      ],
      markupPercent: 0, deliveryPrice: 0, vatRate: 15,
    });
    expect(t.lines.map((l) => l.total)).toEqual(['167315.09', '50218.80']);
    expect(t).toMatchObject({ labour: '44018.80', material: '167315.09', other: '6200.00', cost: '217533.89', equipment: '217533.89', totalExVat: '217533.89' });
  });

  it('prices one unit, rounds it, then multiplies by the quantity, so Qty × Unit Price is the Total', () => {
    const l = lineTotals(line({ quantity: 3, materials: ['1000.00'], otherCosts: [{ quantity: 1, unitCost: 0.01 }] }), 33.33);
    // 1000.01 × 33.33% = 333.3033… → 333.30; unit price 1333.31; × 3.
    expect(l).toEqual({ quantity: 3, markupPercent: '33.33', labour: '0.00', material: '1000.00', other: '0.01', unitCost: '1000.01', unitMarkup: '333.30', unitPrice: '1333.31', total: '3999.93' });
    const t = costingTotals({ lines: [line({ quantity: 3, materials: ['1000.00'], otherCosts: [{ quantity: 1, unitCost: 0.01 }] })], markupPercent: 33.33, deliveryPrice: 100, vatRate: 15 });
    // The overall figures count every unit, and still add up: cost + markup = equipment.
    expect(t).toMatchObject({ material: '3000.00', other: '0.03', cost: '3000.03', markup: '999.90', equipment: '3999.93', totalExVat: '4099.93' });
  });

  it('adds up one line of quantity 1 exactly as the single equipment line did before lines', () => {
    // The figures of a Sales RFQ approved before migration 58: labour 5 650, material 9 000, 40%, delivery 500.
    const t = costingTotals({ lines: [line({ labour: [{ hours: 10, hourlyRate: 400 }, { hours: 5.5, hourlyRate: 300 }], materials: ['9000.00'] })], markupPercent: 40, deliveryPrice: 500, vatRate: 15 });
    expect([t.equipment, t.totalExVat, t.vat, t.totalIncVat]).toEqual(['20510.00', '21010.00', '3151.50', '24161.50']);
  });
});

describe("a Procurement quote's value for costing", () => {
  const rfq = { lines: [{ id: 'l-1', quantity: 10 }, { id: 'l-2', quantity: 2 }] };
  const quote = (prices: Array<[string, number]>, over: Record<string, unknown> = {}) => ({
    quotedAt: new Date('2026-11-01'), declined: false, currency: 'ZAR', supplier: { currency: 'ZAR' },
    prices: prices.map(([rfqLineId, unitPrice]) => ({ rfqLineId, unitPrice })), ...over,
  });

  it('is the lines it priced, excl. VAT, in rand', () => {
    expect(quoteValue(rfq, quote([['l-1', 900], ['l-2', 12.5]]), {})).toEqual({ total: '9025.00', currency: 'ZAR', amount: '9025.00', unpricedLines: 0 });
  });

  it("counts the lines a supplier didn't price, and leaves them out", () => {
    expect(quoteValue(rfq, quote([['l-1', 900]]), {})).toMatchObject({ total: '9000.00', unpricedLines: 1 });
  });

  it("is in rand at the Settings exchange rate for another currency, and unknown in rand without one", () => {
    const usd = quote([['l-2', 100]], { currency: 'USD' });
    expect(quoteValue(rfq, usd, { USD: 18.25 })).toMatchObject({ total: '200.00', currency: 'USD', amount: '3650.00' });
    expect(quoteValue(rfq, usd, { USD: 0 })?.amount).toBeNull();
  });

  it("is nothing for a supplier who hasn't quoted or declined", () => {
    expect(quoteValue(rfq, quote([], { quotedAt: null }), {})).toBeNull();
    expect(quoteValue(rfq, quote([['l-1', 1]], { declined: true }), {})).toBeNull();
    expect(quoteValue(rfq, undefined, {})).toBeNull();
  });
});

describe('quotation references', () => {
  it("count up per project in the template's form", () => {
    expect(nextQuoteReference('AFRI-1469', [])).toBe('AFRI-02A-1469-04-1');
    expect(nextQuoteReference('AFRI-1469', ['AFRI-02A-1469-04-1', 'AFRI-02A-1469-04-2', 'AFRI-02A-14690-04-7'])).toBe('AFRI-02A-1469-04-3');
  });

  it('use the project number as it is for one numbered otherwise', () => {
    expect(nextQuoteReference('P77', ['Q-P77-1'])).toBe('Q-P77-2');
  });
});
