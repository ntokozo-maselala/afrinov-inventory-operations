import { describe, it, expect } from 'vitest';
import { formatRate, priceLines } from './poMoney';

describe('priceLines', () => {
  it('works each line out like the server: rounded to cents, half up, then summed', () => {
    const { lines, totals } = priceLines([{ orderedQty: '3', unitPrice: '12.5' }, { orderedQty: 2, unitPrice: 10 }], 15);
    expect(lines[0]).toMatchObject({ subtotal: '37.50', vat: '5.63', net: '43.13' });
    expect(totals).toEqual({ subtotal: '57.50', vat: '8.63', net: '66.13', unpricedLines: 0 });
  });

  it('leaves blank prices out and counts them; 0 is a price', () => {
    const { totals } = priceLines([{ orderedQty: 1, unitPrice: '' }, { orderedQty: 1, unitPrice: null }, { orderedQty: 4, unitPrice: 0 }], 15);
    expect(totals).toEqual({ subtotal: '0.00', vat: '0.00', net: '0.00', unpricedLines: 2 });
  });
});

describe('formatRate', () => {
  it('shows whole rates without decimals', () => {
    expect(formatRate('15')).toBe('15%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate('15.5')).toBe('15.5%');
  });
});
