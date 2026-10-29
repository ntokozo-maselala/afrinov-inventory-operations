// The award's reason rule on screen compares money exactly, as the server does.
import { describe, it, expect } from 'vitest';
import { awardConcerns, cents, quoteCurrency, type RfqSupplier } from './rfq';

const quote = (id: string, net: string, extra: Partial<RfqSupplier> = {}): RfqSupplier => ({
  supplierId: id, supplier: { id, name: id.toUpperCase(), currency: 'ZAR' }, quotedAt: '2026-10-29T00:00:00.000Z', declined: false,
  totals: { subtotal: net, vat: '0.00', net, unpricedLines: 0 }, ...extra,
});

describe('cents and awardConcerns', () => {
  it('reads a money string in whole cents however large', () => {
    expect(cents('690.00')).toBe(69000n);
    expect(cents('9999999999999999.99') - cents('9999999999999999.98')).toBe(1n);
  });

  it('tells apart totals a cent apart that doubles would round together', () => {
    const rfq = { suppliers: [quote('a', '9999999999999999.99'), quote('b', '9999999999999999.98')] };
    expect(awardConcerns(rfq, 'a', '2026-10-29')).toEqual(['B quoted less for every line: ZAR 9999999999999999.98 against 9999999999999999.99']);
    expect(awardConcerns(rfq, 'b', '2026-10-29')).toEqual([]);
  });

  it('weighs a quote in the currency it was given in', () => {
    const inEuro = quote('b', '100.00', { currency: 'EUR' });
    expect(quoteCurrency(inEuro)).toBe('EUR');
    // A cheaper quote given in euros isn't weighed against one in rand.
    expect(awardConcerns({ suppliers: [quote('a', '736.00'), inEuro] }, 'a', '2026-10-29')).toEqual([]);
  });
});
