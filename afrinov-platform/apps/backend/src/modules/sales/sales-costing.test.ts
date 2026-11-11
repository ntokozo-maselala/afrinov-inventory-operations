// The Sales RFQ's money: labour and material added up, the markup on the whole,
// delivery after it, and VAT last; a Procurement quote's value; quotation references.
import { describe, it, expect } from 'vitest';
import { costingTotals, labourLineTotal, nextQuoteReference, quoteValue } from './sales-costing.js';

describe('Sales RFQ costing', () => {
  it('puts the markup on labour and material together, and delivery after it, as the quotation shows', () => {
    const t = costingTotals({
      labour: [{ hours: 10, hourlyRate: 400 }, { hours: 5.5, hourlyRate: 300 }],
      materials: ['9000.00'],
      markupPercent: 40,
      deliveryPrice: 500,
      vatRate: 15,
    });
    expect(t).toEqual({
      labour: '5650.00', material: '9000.00', cost: '14650.00', markup: '5860.00', equipment: '20510.00', delivery: '500.00',
      totalExVat: '21010.00', vatRate: '15', vat: '3151.50', totalIncVat: '24161.50',
    });
  });

  it('gives the cost but nothing marked up until there is a markup', () => {
    const t = costingTotals({ labour: [{ hours: 1, hourlyRate: 150 }], materials: [], markupPercent: null, deliveryPrice: 0, vatRate: 15 });
    expect(t).toMatchObject({ cost: '150.00', markup: null, equipment: null, totalExVat: null, vat: null, totalIncVat: null });
  });

  it('rounds each step to cents, half up', () => {
    expect(labourLineTotal({ hours: 0.33, hourlyRate: 250 })).toBe('82.50');
    const t = costingTotals({ labour: [], materials: ['100.01'], markupPercent: 12.5, deliveryPrice: 0, vatRate: 15 });
    // 100.01 × 12.5% = 12.50125 → 12.50; 112.51 × 15% = 16.8765 → 16.88.
    expect(t).toMatchObject({ markup: '12.50', equipment: '112.51', vat: '16.88', totalIncVat: '129.39' });
  });

  it('matches the Northam Platinum quotation from its equipment price', () => {
    const t = costingTotals({ labour: [], materials: ['154866.25'], markupPercent: 0, deliveryPrice: 0, vatRate: 15 });
    expect(t).toMatchObject({ totalExVat: '154866.25', vat: '23229.94', totalIncVat: '178096.19' });
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
