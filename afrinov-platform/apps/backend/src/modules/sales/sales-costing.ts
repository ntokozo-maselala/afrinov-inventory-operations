// The money on a Sales RFQ, worked out in one place so the page, the Director's
// approval and the quotation show the same figures. All rand, excl. VAT until
// the last two.
//
// Each equipment line, for one unit of it:
//
//   labour       = Σ hours × hourly rate, each line rounded to cents
//   material     = Σ the chosen quote on each of its Procurement RFQs, in rand
//                  at the Settings exchange rate for another currency
//   other        = Σ quantity × unit cost (accommodation, LOA), each rounded
//   unit cost    = labour + material + other
//   unit markup  = unit cost × markup% (the sheet's "× 1.4" is 40%)
//   unit price   = unit cost + unit markup: the quotation's Unit Price
//   total        = unit price × quantity: its Total Price
//
// The quotation, over all its lines:
//
//   labour, material, other, cost, markup = each line's × its quantity, added up
//   equipment    = Σ line totals (= cost + markup)
//   total ex VAT = equipment + delivery (delivery carries no markup)
//   VAT          = total ex VAT × VAT rate
//   total inc VAT
//
// Rounded half up to cents at each step, as orders are (po-pricing.ts). The unit
// price is rounded before it is multiplied, so the quotation's Qty × Unit Price
// is always its Total Price. One line of quantity 1 with no other costs adds up
// exactly as the single equipment line did before lines (migration 58).
import { Prisma } from '@prisma/client';
import { orderTotals } from '../procurement/po-pricing.js';

type Num = Prisma.Decimal | number | string;
const D = (v: Num) => new Prisma.Decimal(v);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** One equipment line's money. The markup-dependent figures are null until a markup is given. */
export interface LineTotals {
  quantity: number;
  /** For one unit. */
  labour: string;
  material: string;
  other: string;
  unitCost: string;
  unitMarkup: string | null;
  unitPrice: string | null;
  /** Unit price × quantity. */
  total: string | null;
}

export interface CostingTotals {
  labour: string;
  material: string;
  other: string;
  cost: string;
  /** Null until a markup is given. */
  markup: string | null;
  /** All the equipment lines together. */
  equipment: string | null;
  delivery: string;
  totalExVat: string | null;
  vatRate: string;
  vat: string | null;
  totalIncVat: string | null;
  /** Each equipment line's, in order. */
  lines: LineTotals[];
}

export interface CostingLine {
  quantity: number;
  labour: Array<{ hours: Num; hourlyRate: Num }>;
  materials: Num[];
  otherCosts: Array<{ quantity: Num; unitCost: Num }>;
}

export function labourLineTotal(line: { hours: Num; hourlyRate: Num }): string {
  return cents(D(line.hours).times(D(line.hourlyRate))).toFixed(2);
}

export function otherCostTotal(cost: { quantity: Num; unitCost: Num }): string {
  return cents(D(cost.quantity).times(D(cost.unitCost))).toFixed(2);
}

export function lineTotals(line: CostingLine, markupPercent: Num | null): LineTotals {
  const labour = line.labour.reduce((sum, l) => sum.plus(labourLineTotal(l)), D(0));
  const material = line.materials.reduce<Prisma.Decimal>((sum, m) => sum.plus(D(m)), D(0));
  const other = line.otherCosts.reduce((sum, c) => sum.plus(otherCostTotal(c)), D(0));
  const unitCost = labour.plus(material).plus(other);
  const base = { quantity: line.quantity, labour: labour.toFixed(2), material: material.toFixed(2), other: other.toFixed(2), unitCost: unitCost.toFixed(2) };
  if (markupPercent === null || markupPercent === undefined) return { ...base, unitMarkup: null, unitPrice: null, total: null };
  const unitMarkup = cents(unitCost.times(D(markupPercent)).dividedBy(100));
  const unitPrice = unitCost.plus(unitMarkup);
  return { ...base, unitMarkup: unitMarkup.toFixed(2), unitPrice: unitPrice.toFixed(2), total: unitPrice.times(line.quantity).toFixed(2) };
}

export function costingTotals(input: {
  lines: CostingLine[];
  markupPercent: Num | null;
  deliveryPrice: Num;
  vatRate: Num;
}): CostingTotals {
  const lines = input.lines.map((l) => lineTotals(l, input.markupPercent));
  const sum = (pick: (l: LineTotals) => string) => lines.reduce((s, l) => s.plus(D(pick(l)).times(l.quantity)), D(0));
  const labour = sum((l) => l.labour);
  const material = sum((l) => l.material);
  const other = sum((l) => l.other);
  const cost = sum((l) => l.unitCost);
  const delivery = cents(D(input.deliveryPrice));
  const vatRate = D(input.vatRate);
  const base = { labour: labour.toFixed(2), material: material.toFixed(2), other: other.toFixed(2), cost: cost.toFixed(2), delivery: delivery.toFixed(2), vatRate: vatRate.toString(), lines };
  if (input.markupPercent === null || input.markupPercent === undefined) {
    return { ...base, markup: null, equipment: null, totalExVat: null, vat: null, totalIncVat: null };
  }
  const markup = sum((l) => l.unitMarkup!);
  const equipment = lines.reduce((s, l) => s.plus(D(l.total!)), D(0));
  const totalExVat = equipment.plus(delivery);
  const vat = cents(totalExVat.times(vatRate).dividedBy(100));
  return {
    ...base, markup: markup.toFixed(2), equipment: equipment.toFixed(2), totalExVat: totalExVat.toFixed(2),
    vat: vat.toFixed(2), totalIncVat: totalExVat.plus(vat).toFixed(2),
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
