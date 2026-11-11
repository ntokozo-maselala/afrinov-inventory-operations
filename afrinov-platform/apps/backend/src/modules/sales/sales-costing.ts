// The money on a Sales RFQ, worked out in one place so the page, the Director's
// approval and the quotation show the same figures. All rand, excl. VAT until
// the last two:
//
//   labour       = Σ hours × hourly rate, each line rounded to cents
//   material     = Σ the chosen quote on each Procurement RFQ, in rand at the
//                  Settings exchange rate for another currency
//   cost         = labour + material
//   markup       = cost × markup% (the sheet's "× 1.4" is 40%)
//   equipment    = cost + markup: the quotation's one equipment line
//   total ex VAT = equipment + delivery (delivery carries no markup)
//   VAT          = total ex VAT × VAT rate
//   total inc VAT
//
// Rounded half up to cents at each step, as orders are (po-pricing.ts).
import { Prisma } from '@prisma/client';
import { orderTotals } from '../procurement/po-pricing.js';

type Num = Prisma.Decimal | number | string;
const D = (v: Num) => new Prisma.Decimal(v);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface CostingTotals {
  labour: string;
  material: string;
  cost: string;
  /** Null until a markup is given. */
  markup: string | null;
  equipment: string | null;
  delivery: string;
  totalExVat: string | null;
  vatRate: string;
  vat: string | null;
  totalIncVat: string | null;
}

export function labourLineTotal(line: { hours: Num; hourlyRate: Num }): string {
  return cents(D(line.hours).times(D(line.hourlyRate))).toFixed(2);
}

export function costingTotals(input: {
  labour: Array<{ hours: Num; hourlyRate: Num }>;
  materials: Num[];
  markupPercent: Num | null;
  deliveryPrice: Num;
  vatRate: Num;
}): CostingTotals {
  const labour = input.labour.reduce((sum, l) => sum.plus(labourLineTotal(l)), D(0));
  const material = input.materials.reduce<Prisma.Decimal>((sum, m) => sum.plus(D(m)), D(0));
  const cost = labour.plus(material);
  const delivery = cents(D(input.deliveryPrice));
  const vatRate = D(input.vatRate);
  if (input.markupPercent === null || input.markupPercent === undefined) {
    return {
      labour: labour.toFixed(2), material: material.toFixed(2), cost: cost.toFixed(2), markup: null, equipment: null,
      delivery: delivery.toFixed(2), totalExVat: null, vatRate: vatRate.toString(), vat: null, totalIncVat: null,
    };
  }
  const markup = cents(cost.times(D(input.markupPercent)).dividedBy(100));
  const equipment = cost.plus(markup);
  const totalExVat = equipment.plus(delivery);
  const vat = cents(totalExVat.times(vatRate).dividedBy(100));
  return {
    labour: labour.toFixed(2), material: material.toFixed(2), cost: cost.toFixed(2), markup: markup.toFixed(2),
    equipment: equipment.toFixed(2), delivery: delivery.toFixed(2), totalExVat: totalExVat.toFixed(2),
    vatRate: vatRate.toString(), vat: vat.toFixed(2), totalIncVat: totalExVat.plus(vat).toFixed(2),
  };
}

/** The Procurement RFQs a Sales RFQ may take its material from: sent to suppliers, or since awarded. */
export const COSTED_RFQ_STATUSES = ['SENT', 'AWARDED'] as const;

export interface QuoteValue {
  /** Excl. VAT, in the quote's currency: the lines the supplier priced. */
  total: string;
  currency: string;
  /** In rand at the day's exchange rate; null for another currency with no rate set. */
  amount: string | null;
  /** Lines the supplier didn't price, left out of the total. */
  unpricedLines: number;
}

/**
 * One supplier's recorded quote on a Procurement RFQ, valued for costing: each
 * line priced at quantity × unit price, rounded to cents, as an order would be.
 * Null when they haven't quoted or declined.
 */
export function quoteValue(
  rfq: { lines: Array<{ id: string; quantity: Num }> },
  quote: { quotedAt: Date | null; declined: boolean; currency: string | null; supplier: { currency: string | null }; prices: Array<{ rfqLineId: string; unitPrice: Num }> } | undefined,
  rates: Record<string, number>,
): QuoteValue | null {
  if (!quote || !quote.quotedAt || quote.declined) return null;
  const priced = rfq.lines.map((l) => ({ orderedQty: l.quantity, unitPrice: quote.prices.find((p) => p.rfqLineId === l.id)?.unitPrice ?? null }));
  const totals = orderTotals(priced, 0);
  const currency = quote.currency ?? quote.supplier.currency ?? 'ZAR';
  const rate = currency === 'ZAR' ? 1 : rates[currency];
  return {
    total: totals.subtotal, currency, unpricedLines: totals.unpricedLines,
    amount: rate ? cents(D(totals.subtotal).times(rate)).toFixed(2) : null,
  };
}

/**
 * The quotation's "Our Reference": AFRI-02A-1469-04-1, -2, … for AFRI-1469, as
 * the quotation template numbers them; Q-<project>-1 for a project numbered
 * otherwise. One past the highest already given for the project.
 */
export function nextQuoteReference(projectNumber: string, given: string[]): string {
  const afrinov = /^AFRI-(\d+)$/.exec(projectNumber);
  const prefix = afrinov ? `AFRI-02A-${afrinov[1]}-04-` : `Q-${projectNumber}-`;
  const highest = given.reduce((max, ref) => {
    const rest = ref.startsWith(prefix) ? ref.slice(prefix.length) : '';
    return /^\d+$/.test(rest) ? Math.max(max, Number(rest)) : max;
  }, 0);
  return `${prefix}${highest + 1}`;
}

/** What the quotation's Conditions say until Sales changes them, as on the Northam Platinum quotation. */
export const DEFAULT_CONDITIONS = {
  paymentTerms: '30 days from invoice date.',
  validity: '30 days from issue of quotation.',
  deliveryDuration: '2 - 4 weeks from date of receiving official order.',
} as const;
