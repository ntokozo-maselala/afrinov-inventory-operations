// Sales requests for quotation as the API returns them (sales-rfq.service.ts):
// how Sales prices one piece of equipment for the client, from labour at the
// listed rates and the project's approved orders, with the job's markup. The
// sums are the server's (sales-costing.ts); costingPreview mirrors them so the
// form can show the price while it is typed.
import type { RfqPerson } from './rfq';

export type SalesRfqStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'CANCELLED';

export interface LabourRate { id: string; role: string; hourlyRate: string; active: boolean }

export interface SalesLabourLine {
  id: string;
  lineNo: number;
  labourRateId: string;
  role: string;
  hours: string;
  hourlyRate: string;
  total: string;
}

/** One supplier's whole quote on a Procurement RFQ, counted as material. */
export interface SalesMaterial {
  rfqId: string;
  rfqNumber: string;
  rfqStatus: string;
  description: string | null;
  supplierId: string;
  supplier: string;
  currency: string;
  /** Excl. VAT, in the quote's currency. */
  quoteTotal: string;
  /** Rand excl. VAT. */
  amount: string;
  /** Lines the supplier didn't price. */
  unpricedLines: number;
  /** The supplier Procurement recommends for costing, if it recommends one. */
  recommendedSupplier: { id: string; name: string } | null;
  /** This is the recommended quote, or Procurement recommends none. */
  recommended: boolean;
  /** On a draft: the RFQ was cancelled, the quote withdrawn, or it can't be valued in rand. */
  unusable: boolean;
}

export interface SalesTotals {
  labour: string;
  material: string;
  cost: string;
  markup: string | null;
  equipment: string | null;
  delivery: string;
  totalExVat: string | null;
  vatRate: string;
  vat: string | null;
  totalIncVat: string | null;
}

export interface SalesRfq {
  id: string;
  number: string;
  quoteReference: string | null;
  status: SalesRfqStatus;
  projectNumber: string;
  project?: { projectNumber: string; name?: string | null; client?: string | null } | null;
  equipment: string | null;
  description: string | null;
  notes: string | null;
  penaltiesApply: boolean;
  markupPercent: string | null;
  deliveryPrice: string;
  vatRate: string | null;
  clientName: string | null;
  clientAddress: string | null;
  contactName: string | null;
  clientReference: string | null;
  paymentTerms: string | null;
  validity: string | null;
  deliveryDuration: string | null;
  deliveryTerms: string | null;
  signerPhone: string | null;
  signerEmail: string | null;
  issuedAt: string | null;
  closingDate: string | null;
  createdAt: string;
  createdById?: string;
  createdBy?: (RfqPerson & { email?: string }) | null;
  submittedAt: string | null;
  submittedById?: string | null;
  submittedBy?: (RfqPerson & { email?: string }) | null;
  approvedAt: string | null;
  approvedBy?: RfqPerson | null;
  returnedAt: string | null;
  returnedBy?: RfqPerson | null;
  returnReason: string | null;
  cancelledAt: string | null;
  cancelledBy?: RfqPerson | null;
  cancellationReason: string | null;
  labour: SalesLabourLine[];
  materials: SalesMaterial[];
  totals: SalesTotals;
}

/** A supplier's quote on a Procurement RFQ, as GET /sales-rfqs/quote-options lists it. */
export interface SalesQuote {
  supplierId: string;
  supplier: string;
  /** Excl. VAT, in its currency. */
  total: string;
  currency: string;
  /** In rand; null for another currency with no exchange rate set. */
  amount: string | null;
  unpricedLines: number;
  recommended: boolean;
}

/** One of the project's sent Procurement RFQs, with the quotes it has. */
export interface SalesQuoteOption {
  id: string;
  number: string;
  status: string;
  description: string | null;
  issuedAt: string | null;
  recommendedSupplierId: string | null;
  quotes: SalesQuote[];
  /** Other Sales RFQs already counting it. */
  salesRfqs: Array<{ id: string; number: string }>;
}

/**
 * The quote a Sales RFQ starts from on an RFQ: Procurement's recommendation,
 * or else the lowest in rand. Null when none can be valued.
 */
export function defaultQuote(option: Pick<SalesQuoteOption, 'quotes'>): SalesQuote | null {
  const usable = option.quotes.filter((q) => q.amount !== null);
  return usable.find((q) => q.recommended) ?? [...usable].sort((a, b) => Number(a.amount) - Number(b.amount))[0] ?? null;
}

export const SALES_STATUS_LABEL: Record<SalesRfqStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved',
  CANCELLED: 'Cancelled',
};

/** Whether this person may approve it: the Director, and never one they raised or submitted. */
export function mayApprove(r: Pick<SalesRfq, 'status' | 'createdById' | 'createdBy' | 'submittedById' | 'submittedBy'>, userId: string | undefined, canApprove: boolean): boolean {
  if (!canApprove || r.status !== 'PENDING_APPROVAL' || !userId) return false;
  const raised = r.createdById ?? r.createdBy?.id;
  const submitted = r.submittedById ?? r.submittedBy?.id;
  return raised !== userId && submitted !== userId;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The totals as the server will work them out, for the form while it is typed:
 * each labour line and the markup rounded to cents, VAT on the total with delivery.
 */
export function costingPreview(input: {
  labour: Array<{ hours: number; hourlyRate: number }>;
  materials: number[];
  markupPercent: number | null;
  deliveryPrice: number;
  vatRate: number;
}): { labour: number; material: number; cost: number; markup: number | null; equipment: number | null; totalExVat: number | null; vat: number | null; totalIncVat: number | null } {
  const labour = input.labour.reduce((sum, l) => sum + cents(l.hours * l.hourlyRate), 0);
  const material = input.materials.reduce((sum, m) => sum + m, 0);
  const cost = cents(labour + material);
  if (input.markupPercent === null) return { labour: cents(labour), material: cents(material), cost, markup: null, equipment: null, totalExVat: null, vat: null, totalIncVat: null };
  const markup = cents((cost * input.markupPercent) / 100);
  const equipment = cents(cost + markup);
  const totalExVat = cents(equipment + cents(input.deliveryPrice));
  const vat = cents((totalExVat * input.vatRate) / 100);
  return { labour: cents(labour), material: cents(material), cost, markup, equipment, totalExVat, vat, totalIncVat: cents(totalExVat + vat) };
}

/** A number as typed, with a comma or a point; null when blank or not a number. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(',', '.');
  if (t === '' || !/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  return Number(t);
}

/** How many decimal places were typed. */
export const amountDecimals = (text: string) => (text.replace(/\s/g, '').replace(',', '.').split('.')[1] ?? '').length;
