// Decimal arithmetic helpers (ADR-002: balances are exact, no floats).
import { Prisma } from '@prisma/client';
import { z } from 'zod';

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

/**
 * Stock quantities are stored as Decimal(18, 4). A finer quantity would be
 * rounded on the way in, so 0.00001 would be stored as zero; one too large
 * would not fit. Both are refused before they are written.
 */
export const QUANTITY_DECIMALS = 4;
export function fitsQuantityColumn(d: Prisma.Decimal): boolean {
  return d.decimalPlaces() <= QUANTITY_DECIMALS && d.abs().lt('1e14');
}
export const QUANTITY_PRECISION_MESSAGE = `Quantities can have at most ${QUANTITY_DECIMALS} decimal places`;

const fitsColumn = (q: number) => fitsQuantityColumn(toDecimal(q));

/** A positive quantity the Decimal(18, 4) columns can hold exactly; finer ones would be stored rounded, even as zero. */
export const storedQuantity = z.number().positive().refine(fitsColumn, { message: QUANTITY_PRECISION_MESSAGE });
/** The same, 0 allowed: a counted shelf can be empty. */
export const storedCount = z.number().min(0).refine(fitsColumn, { message: QUANTITY_PRECISION_MESSAGE });
/** The same, either sign: an adjustment, or the system's figure on a count. */
export const storedSignedQuantity = z.number().refine(fitsColumn, { message: QUANTITY_PRECISION_MESSAGE });