// Decimal arithmetic helpers (ADR-002: balances are exact, no floats).
import { Prisma } from '@prisma/client';

export const ZERO = new Prisma.Decimal(0);

export function toDecimal(v: number | string | Prisma.Decimal): Prisma.Decimal {
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(v);
}

export function decimalsEqual(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.equals(b);
}

export function gtZero(d: Prisma.Decimal): boolean {
  return d.gt(ZERO);
}

export function gteZero(d: Prisma.Decimal): boolean {
  return d.gte(ZERO);
}