// How a stock quantity is typed and read. An item's unit says whether it is
// counted (each, pair, box: whole numbers only) or measured (m, kg, l: up to
// the 4 decimal places the server stores). The server holds the list of units
// and refuses the same things; this lets a form say so before it posts.

export type UnitKind = 'COUNTED' | 'MEASURED';

/** A unit of measure as GET /units-of-measure lists it. */
export interface UnitOfMeasure {
  code: string;
  label: string;
  kind: UnitKind;
  /** Carried over from before the list, matching none of its codes. */
  needsReview: boolean;
  active: boolean;
}

export const QUANTITY_DECIMALS = 4;

/**
 * The kind of an item's unit. Until the list has loaded, or for a unit not on
 * it, a quantity is taken as measured: the server still refuses part of a
 * counted item, so nothing wrong is posted.
 */
export function unitKindOf(units: readonly UnitOfMeasure[] | null | undefined, code: string | null | undefined): UnitKind {
  return units?.find((u) => u.code === code)?.kind ?? 'MEASURED';
}

export type ParsedQuantity =
  | { ok: true; value: number }
  | { ok: false; empty: boolean; error: string };

interface ParseOptions {
  /** A count may be 0 (an empty shelf); every movement needs more. */
  allowZero?: boolean;
}

/**
 * What was typed, read leniently for running totals and previews: 2,5 is 2.5
 * and spaces between thousands are ignored. NaN when it is not a number. A
 * form still checks it with parseQuantity before it posts.
 */
export function readQuantity(text: string): number {
  const t = text.replace(/\s/g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
}

/**
 * The first line whose quantity can't be posted, as "Line 2: …", or null when
 * every line is fine. Lines are numbered as the form shows them.
 */
export function firstLineQuantityError(lines: ReadonlyArray<{ text: string; kind: UnitKind; unit: string; line: number }>, opts: ParseOptions = {}): string | null {
  for (const l of lines) {
    const parsed = parseQuantity(l.text, l.kind, l.unit, opts);
    if (!parsed.ok) return `Line ${l.line}: ${parsed.error}`;
  }
  return null;
}

/**
 * Reads what someone typed as a quantity in this unit: a plain number with no
 * sign, a comma or a point for the decimals (2,5 or 2.5), spaces between
 * thousands allowed. Answers the number, or what to tell them.
 */
export function parseQuantity(text: string, kind: UnitKind, unit: string, opts: ParseOptions = {}): ParsedQuantity {
  const t = text.replace(/\s/g, '');
  if (t === '') return { ok: false, empty: true, error: 'Enter a quantity.' };
  if (/^[-+−]/.test(t)) return { ok: false, empty: false, error: 'Enter the quantity without a + or − sign.' };
  if (t.includes(',') && t.includes('.')) return { ok: false, empty: false, error: 'Enter a number, for example 2,5.' };
  const plain = t.replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(plain)) return { ok: false, empty: false, error: 'Enter a number, for example 12.' };
  const decimals = (plain.split('.')[1] ?? '').replace(/0+$/, '').length;
  if (kind === 'COUNTED' && decimals > 0) {
    return { ok: false, empty: false, error: `Counted in whole ${unit}: enter 1, 2, 3 …` };
  }
  if (decimals > QUANTITY_DECIMALS) return { ok: false, empty: false, error: `At most ${QUANTITY_DECIMALS} decimal places.` };
  const value = Number(plain);
  if (!Number.isFinite(value) || value >= 1e14) return { ok: false, empty: false, error: 'That quantity is too large.' };
  if (value === 0 && !opts.allowZero) {
    return { ok: false, empty: false, error: kind === 'COUNTED' ? 'Enter at least 1.' : 'Enter more than 0.' };
  }
  return { ok: true, value };
}
