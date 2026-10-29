// Requests for quotation as the API returns them (rfq.service.ts), and the
// small helpers the RFQ pages share.
import { formatDate } from './format';

export type RfqStatus = 'DRAFT' | 'SENT' | 'AWARDED' | 'CANCELLED';

export interface RfqPerson { id: string; name: string }

export interface RfqLine {
  id: string;
  /** The RFQ sheet's ITEM column: 1, 2, 3, … */
  lineNo: number;
  materialId: string;
  quantity: string;
  material?: { sku: string; name: string; unitOfMeasure: string; category?: string; projectNumber?: string | null };
}

export interface RfqSupplier {
  id?: string;
  supplierId: string;
  /** When the quote came in; null until it is recorded. */
  quotedAt: string | null;
  declined: boolean;
  quoteReference?: string | null;
  validUntil?: string | null;
  leadTime?: string | null;
  notes?: string | null;
  /** A unit price per line the supplier priced, excluding VAT, in their currency. */
  prices?: Array<{ rfqLineId: string; unitPrice: string }>;
  /** VAT at the supplier's currency: the setting for rand, 0% otherwise. */
  vatRate?: number;
  /** The quote priced as an order would be; null until it is recorded. */
  totals?: { subtotal: string; vat: string; net: string; unpricedLines: number } | null;
  /** The currency the quote was given in; the supplier's when it was recorded. */
  currency?: string | null;
  /** Each priced line's subtotal, rounded as the order will round it. */
  lineSubtotals?: Array<{ rfqLineId: string; subtotal: string }>;
  /** The supplier's own quotation PDF, if attached. */
  quoteFile?: { fileName: string; size: number; uploadedAt: string } | null;
  supplier?: {
    id: string; name: string; vendorCode?: string | null; contactName?: string | null; contactEmail?: string | null;
    contactPhone?: string | null; address?: string | null; currency?: string;
  };
}

export interface Rfq {
  id: string;
  number: string;
  status: RfqStatus;
  /** Sent and past its closing date. */
  closed?: boolean;
  projectNumber: string | null;
  project?: { projectNumber: string; name?: string | null } | null;
  description: string | null;
  notes: string | null;
  penaltiesApply: boolean;
  issuedAt: string | null;
  closingDate: string | null;
  createdAt: string;
  createdBy?: RfqPerson | null;
  sentAt?: string | null;
  sentBy?: RfqPerson | null;
  awardedAt?: string | null;
  awardedBy?: RfqPerson | null;
  cancelledAt?: string | null;
  cancelledBy?: RfqPerson | null;
  cancellationReason?: string | null;
  /** The order it was awarded as, and the supplier it went to. */
  purchaseOrder?: { id: string; number: string; status: string; supplierId?: string } | null;
  lines: RfqLine[];
  suppliers: RfqSupplier[];
}

/** Days from sending to closing unless the buyer picks another, as the RFQ sheet's Closing = Issued + 4. */
export const DEFAULT_CLOSING_DAYS = 4;

export function rfqStatusLabel(status: string, closed?: boolean): string {
  if (status === 'SENT' && closed) return 'Closed';
  return ({ DRAFT: 'Draft', SENT: 'Sent', AWARDED: 'Awarded', CANCELLED: 'Cancelled' } as Record<string, string>)[status] ?? status;
}

/**
 * A calendar day the API keeps as midnight UTC, shown as that same day
 * wherever the browser is: read at midday, so no timezone moves it.
 */
export function formatDay(iso: string | null | undefined): string {
  return iso ? formatDate(`${iso.slice(0, 10)}T12:00:00`) : '—';
}

/**
 * Today in South Africa, as YYYY-MM-DD: the day the server issues an RFQ on,
 * whatever the browser's own calendar says.
 */
export function todayInSouthAfrica(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

/** A YYYY-MM-DD day `days` later. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A number with at most 4 decimal places, as the server keeps prices: its
 * 4-place rounding must be the same number, so 0.000000001 is refused rather
 * than saved as 0. As fourDecimals in rfq.routes.ts.
 */
export function fourDecimals(n: number): boolean {
  const kept = Math.round(n * 1e4) / 1e4;
  return Math.abs(n - kept) <= Number.EPSILON * Math.max(1, Math.abs(n)) * 8;
}

/** The currency a quote was given in: its own, or the supplier's for one recorded before quotes kept it. */
export function quoteCurrency(s: RfqSupplier): string {
  return s.currency ?? s.supplier?.currency ?? 'ZAR';
}

/** A money string from the server ("690.00") in whole cents, exactly however large. */
export function cents(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(2, '0').slice(0, 2)}`);
}

/**
 * What a buyer should say why about before awarding to a supplier, as the
 * server works it out (awardConcerns in rfq.service.ts): lines they didn't
 * price, a quote that has run out, a cheaper complete quote in the same
 * currency. Empty: the clear choice.
 */
export function awardConcerns(rfq: Pick<Rfq, 'suppliers'>, chosenId: string, today: string): string[] {
  const quoted = (s: RfqSupplier) => !!s.quotedAt && !s.declined && !!s.totals;
  const name = (s: RfqSupplier) => s.supplier?.name ?? s.supplierId;
  const currency = quoteCurrency;
  const chosen = rfq.suppliers.find((s) => s.supplierId === chosenId);
  if (!chosen || !quoted(chosen)) return [];
  const concerns: string[] = [];
  const unpriced = chosen.totals!.unpricedLines;
  if (unpriced > 0) concerns.push(`${name(chosen)} didn't price ${unpriced === 1 ? '1 line' : `${unpriced} lines`}: the order has ${unpriced === 1 ? 'it' : 'them'} without a price`);
  const until = chosen.validUntil?.slice(0, 10);
  if (until && until < today) concerns.push(`${name(chosen)}'s quote ran out on ${until}`);
  if (unpriced === 0) {
    // In whole cents as BigInt, as the server compares decimals: large totals lose their cents as doubles.
    const net = cents(chosen.totals!.net);
    const cheaper = rfq.suppliers
      .filter((s) => s.supplierId !== chosenId && quoted(s) && currency(s) === currency(chosen) && s.totals!.unpricedLines === 0 && cents(s.totals!.net) < net)
      .sort((a, b) => (cents(a.totals!.net) < cents(b.totals!.net) ? -1 : 1));
    if (cheaper[0]) concerns.push(`${name(cheaper[0])} quoted less for every line: ${currency(cheaper[0])} ${cheaper[0].totals!.net} against ${chosen.totals!.net}`);
  }
  return concerns;
}

/** Quotes in so far, out of the suppliers asked; one who declined has answered too. */
export function quotesIn(rfq: Pick<Rfq, 'suppliers'>): { answered: number; asked: number } {
  return { answered: rfq.suppliers.filter((s) => s.quotedAt || s.declined).length, asked: rfq.suppliers.length };
}
