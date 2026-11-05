import { describe, it, expect } from 'vitest';
import { firstLineQuantityError, parseQuantity, readQuantity, unitKindOf, type UnitOfMeasure } from './quantity';

const UNITS: UnitOfMeasure[] = [
  { code: 'each', label: 'Each', kind: 'COUNTED', needsReview: false, active: true },
  { code: 'm', label: 'Metre', kind: 'MEASURED', needsReview: false, active: true },
];

describe('parseQuantity', () => {
  it('takes whole numbers of a counted unit and refuses any part of one', () => {
    expect(parseQuantity('80', 'COUNTED', 'each')).toEqual({ ok: true, value: 80 });
    expect(parseQuantity('1 200', 'COUNTED', 'each')).toEqual({ ok: true, value: 1200 });
    expect(parseQuantity('80,0', 'COUNTED', 'each')).toEqual({ ok: true, value: 80 });
    expect(parseQuantity('0,0001', 'COUNTED', 'each')).toMatchObject({ ok: false, error: 'Counted in whole each: enter 1, 2, 3 …' });
    expect(parseQuantity('2.5', 'COUNTED', 'pair')).toMatchObject({ ok: false, error: 'Counted in whole pair: enter 1, 2, 3 …' });
  });

  it('takes a comma or a point as the decimal mark for a measured unit, to 4 places', () => {
    expect(parseQuantity('2,5', 'MEASURED', 'm')).toEqual({ ok: true, value: 2.5 });
    expect(parseQuantity('2.5', 'MEASURED', 'm')).toEqual({ ok: true, value: 2.5 });
    expect(parseQuantity('0,0001', 'MEASURED', 'kg')).toEqual({ ok: true, value: 0.0001 });
    expect(parseQuantity('0,00001', 'MEASURED', 'kg')).toMatchObject({ ok: false, error: 'At most 4 decimal places.' });
  });

  it('refuses a sign, a blank, zero and anything that is not a number', () => {
    expect(parseQuantity('-80', 'COUNTED', 'each')).toMatchObject({ ok: false, error: 'Enter the quantity without a + or − sign.' });
    expect(parseQuantity('+5', 'MEASURED', 'm')).toMatchObject({ ok: false });
    expect(parseQuantity('  ', 'COUNTED', 'each')).toMatchObject({ ok: false, empty: true });
    expect(parseQuantity('0', 'COUNTED', 'each')).toMatchObject({ ok: false, error: 'Enter at least 1.' });
    expect(parseQuantity('0', 'MEASURED', 'm')).toMatchObject({ ok: false, error: 'Enter more than 0.' });
    expect(parseQuantity('1.200,5', 'MEASURED', 'm')).toMatchObject({ ok: false, error: 'Enter a number, for example 2,5.' });
    expect(parseQuantity('ten', 'COUNTED', 'each')).toMatchObject({ ok: false, error: 'Enter a number, for example 12.' });
  });

  it('takes the part-unit of what is left of a counted item, so part-units from before the rule can be closed off', () => {
    expect(parseQuantity('0,5', 'COUNTED', 'each', { remainder: 0.5 })).toEqual({ ok: true, value: 0.5 });
    expect(parseQuantity('2,5', 'COUNTED', 'each', { remainder: 2.5 })).toEqual({ ok: true, value: 2.5 });
    expect(parseQuantity('0,5', 'COUNTED', 'each', { remainder: 2.5 })).toEqual({ ok: true, value: 0.5 });
    expect(parseQuantity('0,25', 'COUNTED', 'each', { remainder: 2.5 })).toMatchObject({ ok: false });
    expect(parseQuantity('2', 'COUNTED', 'each', { remainder: 2.5 })).toEqual({ ok: true, value: 2 });
  });

  // Qodo, PR #153: no part of a unit comes out of a whole remainder.
  it('takes no part-unit from a whole remainder', () => {
    expect(parseQuantity('0,5', 'COUNTED', 'each', { remainder: 3 })).toMatchObject({ ok: false, error: 'Counted in whole each: enter 1, 2, 3 …' });
  });

  // Qodo, PR #153: 10 - 9.7 is 0.3000000000000007 in floating point.
  it('compares the remainder to the 4 places the server keeps', () => {
    expect(parseQuantity('0,3', 'COUNTED', 'each', { remainder: 10 - 9.7 })).toEqual({ ok: true, value: 0.3 });
  });

  it('lets a count be 0', () => {
    expect(parseQuantity('0', 'COUNTED', 'each', { allowZero: true })).toEqual({ ok: true, value: 0 });
  });
});

describe('readQuantity', () => {
  it('reads what was typed for running totals, NaN when it is no number', () => {
    expect(readQuantity('2,5')).toBe(2.5);
    expect(readQuantity(' 1 200 ')).toBe(1200);
    expect(readQuantity('')).toBeNaN();
    expect(readQuantity('abc')).toBeNaN();
  });
});

describe('unitKindOf', () => {
  it('answers the kind of a listed unit, and measured until the list is in or for one not on it', () => {
    expect(unitKindOf(UNITS, 'each')).toBe('COUNTED');
    expect(unitKindOf(UNITS, 'm')).toBe('MEASURED');
    expect(unitKindOf(UNITS, 'bundle')).toBe('MEASURED');
    expect(unitKindOf(null, 'each')).toBe('MEASURED');
  });
});

describe('firstLineQuantityError', () => {
  it('names the first line that cannot be posted', () => {
    expect(firstLineQuantityError([
      { text: '3', kind: 'COUNTED', unit: 'each', line: 1 },
      { text: '1,5', kind: 'COUNTED', unit: 'pair', line: 2 },
    ])).toBe('Line 2: Counted in whole pair: enter 1, 2, 3 …');
    expect(firstLineQuantityError([{ text: '1,5', kind: 'MEASURED', unit: 'm', line: 1 }])).toBeNull();
  });
});
