// Purchase order money, worked out the way the server does (po-pricing.ts):
// per line subtotal = unit price x quantity, VAT = subtotal x rate, each
// rounded to cents (half up) before summing. The server's figures are what
// orders show; this is for the new-order form's running total and the mock API.
import { formatCurrency } from './currency';

export interface PoTotals {
  subtotal: string;
  vat: string;
  net: string;
  /** Lines without a price, left out of the totals. */
  unpricedLines: number;
}

export interface LineMoney { subtotal: string | null; vat: string | null; net: string | null }

type Priceable = { orderedQty: string | number; unitPrice?: string | number | null };

const toCents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

export function priceLines<L extends Priceable>(lines: L[], vatRate: number): { lines: Array<L & LineMoney>; totals: PoTotals } {
  let subtotal = 0; let vat = 0; let unpricedLines = 0;
  const priced = lines.map((l) => {
    const price = l.unitPrice === null || l.unitPrice === undefined || l.unitPrice === '' ? null : Number(l.unitPrice);
    if (price === null || !Number.isFinite(price)) { unpricedLines++; return { ...l, subtotal: null, vat: null, net: null }; }
    const s = toCents(price * Number(l.orderedQty));
    const v = Math.round((s * vatRate) / 100);
    subtotal += s; vat += v;
    return { ...l, subtotal: fromCents(s), vat: fromCents(v), net: fromCents(s + v) };
  });
  return { lines: priced, totals: { subtotal: fromCents(subtotal), vat: fromCents(vat), net: fromCents(subtotal + vat), unpricedLines } };
}

/** "R 1 234,56" for a money string from the server; "—" when there is none. */
export function formatMoney(value: string | null | undefined, currency = 'ZAR'): string {
  if (value === null || value === undefined) return '—';
  return formatCurrency(Number(value), currency);
}

const unitPriceFormatters: Record<string, Intl.NumberFormat> = {};

/**
 * A unit price as it is kept, to 4 decimal places ("R 0,0001"), where
 * formatMoney rounds to cents: two prices a fraction of a cent apart stay apart.
 */
export function formatUnitPrice(value: string | null | undefined, currency = 'ZAR'): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  unitPriceFormatters[currency] ??= new Intl.NumberFormat('en-ZA', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return unitPriceFormatters[currency].format(n);
}

/** "15%" or "0%"; up to two decimals. */
export function formatRate(rate: string | number | null | undefined): string {
  const n = Number(rate ?? 0);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}%`;
}
