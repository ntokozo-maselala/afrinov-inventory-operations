import { describe, it, expect } from 'vitest';
import { discountedUnitPrice, formatRate, priceLines } from './poMoney';

describe('priceLines', () => {
  it('works each line out like the server: rounded to cents, half up, then summed', () => {
    const { lines, totals } = priceLines([{ orderedQty: '3', unitPrice: '12.5' }, { orderedQty: 2, unitPrice: 10 }], 15);
    expect(lines[0]).toMatchObject({ subtotal: '37.50', vat: '5.63', net: '43.13' });
    expect(totals).toEqual({ subtotal: '57.50', vat: '8.63', net: '66.13', unpricedLines: 0, discount: '0.00' });
  });

  it('leaves blank prices out and counts them; 0 is a price', () => {
    const { totals } = priceLines([{ orderedQty: 1, unitPrice: '' }, { orderedQty: 1, unitPrice: null }, { orderedQty: 4, unitPrice: 0 }], 15);
    expect(totals).toEqual({ subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 2, discount: '0.00' });
  });

  // The same figures as the server's po-pricing tests.
  it('takes a line\'s discount off its price, and adds up the savings', () => {
    const { lines, totals } = priceLines([
      { orderedQty: 60, unitPrice: 95, discountPercent: 10 },
      { orderedQty: 10, unitPrice: 850, discountPercent: '5.5' },
      { orderedQty: 1, unitPrice: 100 },
      { orderedQty: 4 },
    ], 15);
    expect(lines[0]).toMatchObject({ subtotal: '5130.00', vat: '769.50', net: '5899.50', discount: '570.00' });
    expect(totals).toEqual({ subtotal: '13262.50', vat: '1989.38', net: '15251.88', unpricedLines: 1, discount: '1037.50' });
    expect(priceLines([{ orderedQty: 3, unitPrice: 12.5, discountPercent: 12.5 }], 0).lines[0]).toMatchObject({ subtotal: '32.81', discount: '4.69' });
  });
});

describe('discountedUnitPrice', () => {
  it('gives the price after the discount, to 4 places, or none without a price', () => {
    expect(discountedUnitPrice({ unitPrice: 95, discountPercent: 10 })).toBe('85.5');
    expect(discountedUnitPrice({ unitPrice: '0.3333', discountPercent: 33.33 })).toBe('0.2222');
    expect(discountedUnitPrice({ unitPrice: '12.5' })).toBe('12.5');
    expect(discountedUnitPrice({ unitPrice: null, discountPercent: 10 })).toBeNull();
  });
});

describe('formatRate', () => {
  it('shows whole rates without decimals', () => {
    expect(formatRate('15')).toBe('15%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate('15.5')).toBe('15.5%');
  });

  // A supplier's discount to 4 places: Hytec's 5/18 off on AFRI-0413_1.
  it('shows a rate to 4 places, without trailing zeros', () => {
    expect(formatRate('27.7778')).toBe('27.7778%');
    expect(formatRate('12.50')).toBe('12.5%');
    expect(formatRate('27.7800')).toBe('27.78%');
  });

  it("prices Hytec's AFRI-0413_1 lines at 27.7778% off, as the server does", () => {
    const lines: Array<[number, string]> = [[8, '4433.04'], [2, '9213.72'], [1, '4420.70'], [4, '1832.95'], [2, '5734.95']];
    const { totals } = priceLines(lines.map(([q, p]) => ({ orderedQty: q, unitPrice: p, discountPercent: '27.7778' })), 15);
    expect(totals).toMatchObject({ subtotal: '55693.54', discount: '21420.62' });
  });
});
