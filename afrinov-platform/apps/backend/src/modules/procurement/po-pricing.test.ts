// Money on a purchase order, as the AFRI-0000_x template works it out.
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { defaultVatRate, discountedUnitPrice, lineMoney, orderTotals, withTotals } from './po-pricing.js';

// A line's discount comes off its unit price; the saving is what Procurement's KPIs count.
describe('line discounts', () => {
  it('takes the discount off the unit price, with VAT on what is paid, and gives the saving', () => {
    // 60 x 95 = 5 700.00 at list; 10% off = 5 130.00; VAT 769.50; saved 570.00.
    expect(lineMoney({ orderedQty: 60, unitPrice: 95, discountPercent: 10 }, 15)).toEqual({ subtotal: '5130.00', vat: '769.50', net: '5899.50', discount: '570.00' });
  });

  it('rounds the discounted line to cents, half up, and the saving with it', () => {
    // 3 x 12.50 = 37.50; 12.5% off = 32.8125 -> 32.81; saved 4.69.
    expect(lineMoney({ orderedQty: 3, unitPrice: 12.5, discountPercent: 12.5 }, 0)).toEqual({ subtotal: '32.81', vat: '0.00', net: '32.81', discount: '4.69' });
  });

  it('gives nothing for 100% off, and adds up the lines\' savings', () => {
    expect(lineMoney({ orderedQty: 2, unitPrice: 10, discountPercent: 100 }, 15)).toMatchObject({ subtotal: '0.00', discount: '20.00' });
    expect(orderTotals([
      { orderedQty: 60, unitPrice: 95, discountPercent: 10 },
      { orderedQty: 10, unitPrice: 850, discountPercent: '5.5' },
      { orderedQty: 1, unitPrice: 100 },
      { orderedQty: 4 },
    ], 15)).toEqual({ subtotal: '13262.50', vat: '1989.38', net: '15251.88', unpricedLines: 1, discount: '1037.50' });
  });

  it('gives the discounted unit price to 4 places, or none without a price', () => {
    expect(discountedUnitPrice({ unitPrice: 95, discountPercent: 10 })).toBe('85.5');
    expect(discountedUnitPrice({ unitPrice: '0.3333', discountPercent: 33.33 })).toBe('0.2222');
    expect(discountedUnitPrice({ unitPrice: 95 })).toBe('95');
    expect(discountedUnitPrice({ unitPrice: null, discountPercent: 10 })).toBeNull();
  });
});

describe('defaultVatRate', () => {
  it('uses the setting for rand suppliers and 0% for other currencies', () => {
    expect(defaultVatRate('ZAR', 15)).toBe(15);
    expect(defaultVatRate('EUR', 15)).toBe(0);
    expect(defaultVatRate('USD', 15)).toBe(0);
  });
});

describe('lineMoney', () => {
  it('rounds each line to cents, half up', () => {
    // 3 x 12.50 = 37.50; VAT 5.625 -> 5.63
    expect(lineMoney({ orderedQty: 3, unitPrice: 12.5 }, 15)).toEqual({ subtotal: '37.50', vat: '5.63', net: '43.13', discount: '0.00' });
    // 0.3333 x 3 = 0.9999 -> 1.00
    expect(lineMoney({ orderedQty: '0.3333', unitPrice: '3' }, 15)).toEqual({ subtotal: '1.00', vat: '0.15', net: '1.15', discount: '0.00' });
  });

  it('works on decimals, not floats', () => {
    expect(lineMoney({ orderedQty: new Prisma.Decimal('0.1'), unitPrice: new Prisma.Decimal('0.2') }, 0)!.subtotal).toBe('0.02');
    expect(lineMoney({ orderedQty: 3, unitPrice: '0.1' }, 0)!.subtotal).toBe('0.30');
  });

  it('has nothing for a line without a price, but a zero price is a price', () => {
    expect(lineMoney({ orderedQty: 3, unitPrice: null }, 15)).toBeNull();
    expect(lineMoney({ orderedQty: 3 }, 15)).toBeNull();
    expect(lineMoney({ orderedQty: 3, unitPrice: 0 }, 15)).toEqual({ subtotal: '0.00', vat: '0.00', net: '0.00', discount: '0.00' });
  });
});

describe('orderTotals', () => {
  it('adds up the rounded lines and counts the unpriced ones', () => {
    // Each line rounds to 0.01 before summing, as on the printed order.
    const lines = [{ orderedQty: 1, unitPrice: 0.005 }, { orderedQty: 1, unitPrice: 0.005 }, { orderedQty: 2, unitPrice: null }];
    expect(orderTotals(lines, 0)).toEqual({ subtotal: '0.02', vat: '0.00', net: '0.02', unpricedLines: 1, discount: '0.00' });
  });

  it('is zero for an order with no prices yet', () => {
    expect(orderTotals([{ orderedQty: 4 }], 15)).toEqual({ subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 1, discount: '0.00' });
  });
});

describe('withTotals', () => {
  it('adds money to each line and the order, keeping the rest', () => {
    const po = withTotals({ id: 'po-1', vatRate: new Prisma.Decimal(15), lines: [{ id: 'l-1', orderedQty: 2, unitPrice: 100 }] });
    expect(po).toMatchObject({ id: 'po-1', lines: [{ id: 'l-1', subtotal: '200.00', vat: '30.00', net: '230.00' }], totals: { net: '230.00' } });
  });
  // Hytec's 5/18 off on AFRI-0413_1, to 4 places: R55 693,54 against the quote's
  // R55 693,57, where 2 places (27.78%) were R1,72 off.
  it('takes a discount to 4 places off each line, as Hytec gave AFRI-0413_1', () => {
    const lines = [[8, 4433.04], [2, 9213.72], [1, 4420.70], [4, 1832.95], [2, 5734.95]];
    const at = (off: string) => orderTotals(lines.map(([q, p]) => ({ orderedQty: q!, unitPrice: p!, discountPercent: off })), 15);
    expect(at('27.7778')).toMatchObject({ subtotal: '55693.54', discount: '21420.62' });
    expect(at('27.78')).toMatchObject({ subtotal: '55691.85', discount: '21422.31' });
  });
});
