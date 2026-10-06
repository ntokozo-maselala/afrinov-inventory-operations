// Decimal arithmetic smoke tests (Prisma.Decimal behaviour we depend on).
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { ZERO, toDecimal, gtZero, gteZero, decimalsEqual } from '../shared/decimal.js';

describe('decimal helpers', () => {
  it('ZERO is zero', () => {
    expect(ZERO.isZero()).toBe(true);
  });

  it('toDecimal accepts numbers, strings, and Decimals', () => {
    expect(toDecimal(5).toString()).toBe('5');
    expect(toDecimal('3.14').toString()).toBe('3.14');
    expect(toDecimal(new Prisma.Decimal('2.71')).toString()).toBe('2.71');
  });

  it('gtZero / gteZero behave correctly', () => {
    expect(gtZero(new Prisma.Decimal('0.0001'))).toBe(true);
    expect(gtZero(ZERO)).toBe(false);
    expect(gtZero(new Prisma.Decimal('-0.1'))).toBe(false);
    expect(gteZero(ZERO)).toBe(true);
    expect(gteZero(new Prisma.Decimal('-0.1'))).toBe(false);
  });

  it('decimalsEqual ignores scale', () => {
    expect(decimalsEqual(new Prisma.Decimal('1.0'), new Prisma.Decimal('1.00'))).toBe(true);
  });
});