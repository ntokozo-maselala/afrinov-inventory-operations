// Money on a purchase order, as the AFRI-0000_x template works it out.
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { defaultVatRate, lineMoney, orderTotals, withTotals } from './po-pricing.js';

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
    expect(lineMoney({ orderedQty: 3, unitPrice: 12.5 }, 15)).toEqual({ subtotal: '37.50', vat: '5.63', net: '43.13' });
    // 0.3333 x 3 = 0.9999 -> 1.00
    expect(lineMoney({ orderedQty: '0.3333', unitPrice: '3' }, 15)).toEqual({ subtotal: '1.00', vat: '0.15', net: '1.15' });
  });

  it('works on decimals, not floats', () => {
    expect(lineMoney({ orderedQty: new Prisma.Decimal('0.1'), unitPrice: new Prisma.Decimal('0.2') }, 0)!.subtotal).toBe('0.02');
    expect(lineMoney({ orderedQty: 3, unitPrice: '0.1' }, 0)!.subtotal).toBe('0.30');
  });

  it('has nothing for a line without a price, but a zero price is a price', () => {
    expect(lineMoney({ orderedQty: 3, unitPrice: null }, 15)).toBeNull();
    expect(lineMoney({ orderedQty: 3 }, 15)).toBeNull();
    expect(lineMoney({ orderedQty: 3, unitPrice: 0 }, 15)).toEqual({ subtotal: '0.00', vat: '0.00', net: '0.00' });
  });
});

describe('orderTotals', () => {
  it('adds up the rounded lines and counts the unpriced ones', () => {
    // Each line rounds to 0.01 before summing, as on the printed order.
    const lines = [{ orderedQty: 1, unitPrice: 0.005 }, { orderedQty: 1, unitPrice: 0.005 }, { orderedQty: 2, unitPrice: null }];
    expect(orderTotals(lines, 0)).toEqual({ subtotal: '0.02', vat: '0.00', net: '0.02', unpricedLines: 1 });
  });

  it('is zero for an order with no prices yet', () => {
    expect(orderTotals([{ orderedQty: 4 }], 15)).toEqual({ subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 1 });
  });
});

describe('withTotals', () => {
  it('adds money to each line and the order, keeping the rest', () => {
    const po = withTotals({ id: 'po-1', vatRate: new Prisma.Decimal(15), lines: [{ id: 'l-1', orderedQty: 2, unitPrice: 100 }] });
    expect(po).toMatchObject({ id: 'po-1', lines: [{ id: 'l-1', subtotal: '200.00', vat: '30.00', net: '230.00' }], totals: { net: '230.00' } });
  });
});
