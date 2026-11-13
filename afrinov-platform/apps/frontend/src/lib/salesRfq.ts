// Sales requests for quotation as the API returns them (sales-rfq.service.ts):
// how Sales prices a job for the client in one or more equipment lines, each
// from labour at the listed rates, the project's Procurement quotes and other
// costs, for one unit, with the job's markup, times its quantity. The sums are
// the server's (sales-costing.ts); costingPreview mirrors them so the form can
// show the price while it is typed.
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

/** A cost on a line that is neither labour nor a quote: accommodation, LOA. */
export interface SalesOtherCost {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitCost: string;
  total: string;
}

/** Material estimated before any supplier has quoted, for one unit of the line: counted as material. */
export interface SalesMaterialAllowance {
  id: string;
  lineNo: number;
  description: string;
  /** Rand excl. VAT, before markup. */
  amount: string;
}

/** One equipment line's money: for one unit, then times its quantity. */
export interface SalesLineTotals {
  quantity: number;
  /** The markup it is priced at: its own, or the job's; null when neither is set. */
  markupPercent: string | null;
  labour: string;
  material: string;
  other: string;
  unitCost: string;
  unitMarkup: string | null;
  unitPrice: string | null;
  total: string | null;
}

/** One line of the quotation, with what it costs for one unit. */
export interface SalesEquipmentLine {
  id: string;
  lineNo: number;
  equipment: string | null;
  /** Printed under it, one per line. */
  details: string | null;
  quantity: number;
  /** Its own markup; null: it takes the job's. */
  markupPercent: string | null;
  labour: SalesLabourLine[];
  materials: SalesMaterial[];
  otherCosts: SalesOtherCost[];
  /** Material allowed for before any supplier quoted; may be missing from older responses. */
  allowances?: SalesMaterialAllowance[];
  totals: SalesLineTotals;
}

export interface SalesTotals {
  labour: string;
  material: string;
  other: string;
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
  /** The first equipment line's name, for lists and the file name. */
  equipment: string | null;
  description: string | null;
  notes: string | null;
  /** Printed on the quotation under the company's Notes, one per line. */
  quoteNotes: string | null;
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
  equipmentLines: SalesEquipmentLine[];
  totals: SalesTotals;
}

/**
 * A line at quantity 0 is priced for the client to see but not charged: the
 * quotation prints its unit price and "R -" (AFRI-0413 lines 3 and 4).
 */
export const isCharged = (l: Pick<SalesEquipmentLine, 'quantity'>) => l.quantity > 0;

/** Every quote counted, on whichever line. */
export const allMaterials = (r: Pick<SalesRfq, 'equipmentLines'>): SalesMaterial[] => r.equipmentLines.flatMap((l) => l.materials);

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

/** One equipment line as the preview prices it, for one unit. */
export interface PreviewLine {
  quantity: number;
  /** Its own markup; null or left out: the job's. */
  markupPercent?: number | null;
  labour: Array<{ hours: number; hourlyRate: number }>;
  materials: number[];
  otherCosts: Array<{ quantity: number; unitCost: number }>;
}

export interface PreviewLineTotals { markupPercent: number | null; unitCost: number; unitPrice: number | null; total: number | null }

/**
 * The totals as the server will work them out, for the form while it is typed:
 * each line for one unit (labour, other costs and the markup rounded to cents),
 * at its own markup or the job's, its unit price rounded before it is multiplied
 * by the quantity, then delivery and VAT on the whole, once every line has a markup.
 */
export function costingPreview(input: {
  lines: PreviewLine[];
  markupPercent: number | null;
  deliveryPrice: number;
  vatRate: number;
}): {
  labour: number; material: number; other: number; cost: number; markup: number | null; equipment: number | null;
  totalExVat: number | null; vat: number | null; totalIncVat: number | null; lines: PreviewLineTotals[];
} {
  const priced = input.lines.map((l) => {
    const m = l.markupPercent ?? input.markupPercent;
    const labour = cents(l.labour.reduce((sum, x) => sum + cents(x.hours * x.hourlyRate), 0));
    const material = cents(l.materials.reduce((sum, x) => sum + x, 0));
    const other = cents(l.otherCosts.reduce((sum, x) => sum + cents(x.quantity * x.unitCost), 0));
    const unitCost = cents(labour + material + other);
    const unitMarkup = m === null ? null : cents((unitCost * m) / 100);
    const unitPrice = unitMarkup === null ? null : cents(unitCost + unitMarkup);
    return { quantity: l.quantity, markupPercent: m, labour, material, other, unitCost, unitMarkup, unitPrice, total: unitPrice === null ? null : cents(unitPrice * l.quantity) };
  });
  const sum = (pick: (l: (typeof priced)[number]) => number) => cents(priced.reduce((s, l) => s + pick(l) * l.quantity, 0));
  const totals = { labour: sum((l) => l.labour), material: sum((l) => l.material), other: sum((l) => l.other), cost: sum((l) => l.unitCost) };
  const lines = priced.map((l) => ({ markupPercent: l.markupPercent, unitCost: l.unitCost, unitPrice: l.unitPrice, total: l.total }));
  if (priced.some((l) => l.markupPercent === null)) return { ...totals, markup: null, equipment: null, totalExVat: null, vat: null, totalIncVat: null, lines };
  const markup = sum((l) => l.unitMarkup!);
  const equipment = cents(priced.reduce((s, l) => s + l.total!, 0));
  const totalExVat = cents(equipment + cents(input.deliveryPrice));
  const vat = cents((totalExVat * input.vatRate) / 100);
  return { ...totals, markup, equipment, totalExVat, vat, totalIncVat: cents(totalExVat + vat), lines };
}

/** A number as typed, with a comma or a point; null when blank or not a number. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(',', '.');
  if (t === '' || !/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  return Number(t);
}

/** How many decimal places were typed. */
export const amountDecimals = (text: string) => (text.replace(/\s/g, '').replace(',', '.').split('.')[1] ?? '').length;
