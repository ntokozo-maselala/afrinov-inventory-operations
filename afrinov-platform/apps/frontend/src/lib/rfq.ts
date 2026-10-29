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
  cancelledAt?: string | null;
  cancelledBy?: RfqPerson | null;
  cancellationReason?: string | null;
  purchaseOrder?: { id: string; number: string; status: string } | null;
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

/** Quotes in so far, out of the suppliers asked; one who declined has answered too. */
export function quotesIn(rfq: Pick<Rfq, 'suppliers'>): { answered: number; asked: number } {
  return { answered: rfq.suppliers.filter((s) => s.quotedAt || s.declined).length, asked: rfq.suppliers.length };
}
