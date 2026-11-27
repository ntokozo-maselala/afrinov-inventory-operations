// How supplier fields are tidied, shared by the Suppliers API and the vendor
// list import so both store the same spelling. The vendor list in the
// AFRI-0000_x purchase order template writes the same terms several ways
// ("C.O.D" and "COD", "30 DAYS NETT" and "30 Days Nett").

export const SUPPLIER_CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP'] as const;

/** Offered in the supplier form; any other text is allowed. */
export const PAYMENT_TERM_SUGGESTIONS = ['C.O.D', '30 DAYS NETT', '60 DAYS NETT', '100% ON ORDER PLACEMENT'] as const;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Trimmed text, or null when nothing is left. */
export function cleanText(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = squash(s);
  return t === '' ? null : t;
}

/** "v001 " -> "V001". */
export function cleanVendorCode(s: string | null | undefined): string | null {
  const t = cleanText(s);
  return t === null ? null : t.replace(/\s/g, '').toUpperCase();
}

/** "COD" and "c.o.d" -> "C.O.D"; "30 Days Nett" -> "30 DAYS NETT"; anything else as typed. */
export function cleanPaymentTerms(s: string | null | undefined): string | null {
  const t = cleanText(s);
  if (t === null) return null;
  if (/^c\.?\s?o\.?\s?d\.?$/i.test(t)) return 'C.O.D';
  const days = /^(\d+)\s*days?\s*net+$/i.exec(t);
  if (days) return `${days[1]} DAYS NETT`;
  return t;
}

/** A separator the vendor list leaves around a website: | , ; or a space. */
const isEdgeSeparator = (c: string) => c === '|' || c === ',' || c === ';' || /\s/.test(c);

/**
 * Drops stray separators the vendor list carries ("www.hydac.co.za | ").
 * Trimmed by walking in from each end, not by a regex: `[|,;\s]+$` is
 * retried from every position of a long run of separators, so its time grows
 * with the square of the length (CodeQL js/polynomial-redos).
 */
export function cleanWebsite(s: string | null | undefined): string | null {
  const t = cleanText(s);
  if (t === null) return null;
  let start = 0;
  let end = t.length;
  while (start < end && isEdgeSeparator(t[start]!)) start++;
  while (end > start && isEdgeSeparator(t[end - 1]!)) end--;
  const stripped = t.slice(start, end);
  return stripped === '' ? null : stripped;
}

/** "EUROS", "euro" -> "EUR"; "Rand" -> "ZAR"; a known code as is; otherwise null. */
export function cleanCurrency(s: string | null | undefined): string | null {
  const t = cleanText(s);
  if (t === null) return null;
  const u = t.toUpperCase();
  if ((SUPPLIER_CURRENCIES as readonly string[]).includes(u)) return u;
  if (/^EUROS?$/.test(u)) return 'EUR';
  if (/^RANDS?$/.test(u)) return 'ZAR';
  if (/^(US )?DOLLARS?$/.test(u)) return 'USD';
  if (/^POUNDS?$/.test(u)) return 'GBP';
  return null;
}

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
