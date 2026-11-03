// Purchase order money, worked out the way the server does (po-pricing.ts):
// per line subtotal = unit price x (1 - discount%) x quantity, VAT = subtotal
// x rate, each rounded to cents (half up) before summing; the discount in
// rand (list less subtotal) is the saving Procurement's KPIs count. The server's figures are what
// orders show; this is for the new-order form's running total and the mock API.
import { formatCurrency } from './currency';

export interface PoTotals {
  subtotal: string;
  vat: string;
  net: string;
  /** Lines without a price, left out of the totals. */
  unpricedLines: number;
  /** What the lines' discounts save, before VAT. Missing from orders read before discounts. */
  discount?: string;
}

export interface LineMoney { subtotal: string | null; vat: string | null; net: string | null; discount: string | null }

type Priceable = { orderedQty: string | number; unitPrice?: string | number | null; discountPercent?: string | number | null };

/** The unit price after the line's discount, to 4 places as unit prices are; null without a price. */
export function discountedUnitPrice(line: { unitPrice?: string | number | null; discountPercent?: string | number | null }): string | null {
  if (line.unitPrice === null || line.unitPrice === undefined || line.unitPrice === '') return null;
  const off = Number(line.discountPercent ?? 0) || 0;
  return String(Math.round(Number(line.unitPrice) * (100 - off) * 100 + Number.EPSILON) / 1e4);
}

const toCents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

export function priceLines<L extends Priceable>(lines: L[], vatRate: number): { lines: Array<L & LineMoney>; totals: PoTotals } {
  let subtotal = 0; let vat = 0; let discount = 0; let unpricedLines = 0;
  const priced = lines.map((l) => {
    const price = l.unitPrice === null || l.unitPrice === undefined || l.unitPrice === '' ? null : Number(l.unitPrice);
    if (price === null || !Number.isFinite(price)) { unpricedLines++; return { ...l, subtotal: null, vat: null, net: null, discount: null }; }
    const off = Number(l.discountPercent ?? 0) || 0;
    const list = toCents(price * Number(l.orderedQty));
    const s = off === 0 ? list : toCents((price * Number(l.orderedQty) * (100 - off)) / 100);
    const v = Math.round((s * vatRate) / 100);
    subtotal += s; vat += v; discount += list - s;
    return { ...l, subtotal: fromCents(s), vat: fromCents(v), net: fromCents(s + v), discount: fromCents(list - s) };
  });
  return { lines: priced, totals: { subtotal: fromCents(subtotal), vat: fromCents(vat), net: fromCents(subtotal + vat), unpricedLines, discount: fromCents(discount) } };
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
