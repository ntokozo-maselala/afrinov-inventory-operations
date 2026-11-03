// Money on a purchase order, worked out in one place so every screen and
// export shows the same figures. As on the AFRI-0000_x template, per line:
// subtotal = unit price x quantity, VAT = subtotal x rate, net = subtotal + VAT,
// and the order totals are the sums of the lines. Each line is rounded to
// cents (half up) before summing, as the template's printed lines are.
//
// A line's discount comes off its unit price first: subtotal = unit price x
// (1 - discount%) x quantity. The discount in rand (list less subtotal) is the
// saving Procurement's KPIs count.
import { Prisma } from '@prisma/client';

type Num = Prisma.Decimal | number | string;
type Priceable = { orderedQty: Num; unitPrice?: Num | null; discountPercent?: Num | null };

const D = (v: Num) => new Prisma.Decimal(v);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const money = (d: Prisma.Decimal) => d.toFixed(2);

/** VAT for a new order: the setting for rand suppliers, 0% for other currencies. */
export function defaultVatRate(currency: string, settingRate: number): number {
  return currency === 'ZAR' ? settingRate : 0;
}

export interface LineMoney {
  subtotal: string; vat: string; net: string;
  /** The saving: the unit price x quantity, less the subtotal. "0.00" for no discount. */
  discount: string;
}

export interface OrderTotals {
  subtotal: string;
  vat: string;
  net: string;
  /** Lines without a price, left out of the totals. */
  unpricedLines: number;
  /** What the lines' discounts save, before VAT. */
  discount: string;
}

/** The unit price after the line's discount, kept to 4 places as unit prices are. */
export function discountedUnitPrice(line: { unitPrice?: Num | null; discountPercent?: Num | null }): string | null {
  if (line.unitPrice === null || line.unitPrice === undefined) return null;
  const off = D(line.discountPercent ?? 0);
  return D(line.unitPrice).times(new Prisma.Decimal(100).minus(off)).dividedBy(100).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toString();
}

export function lineMoney(line: Priceable, vatRate: Num): LineMoney | null {
  if (line.unitPrice === null || line.unitPrice === undefined) return null;
  const list = cents(D(line.unitPrice).times(D(line.orderedQty)));
  const off = D(line.discountPercent ?? 0);
  const subtotal = off.isZero() ? list : cents(D(line.unitPrice).times(D(line.orderedQty)).times(new Prisma.Decimal(100).minus(off)).dividedBy(100));
  const vat = cents(subtotal.times(D(vatRate)).dividedBy(100));
  return { subtotal: money(subtotal), vat: money(vat), net: money(subtotal.plus(vat)), discount: money(list.minus(subtotal)) };
}

export function orderTotals(lines: Priceable[], vatRate: Num): OrderTotals {
  let subtotal = new Prisma.Decimal(0);
  let vat = new Prisma.Decimal(0);
  let discount = new Prisma.Decimal(0);
  let unpricedLines = 0;
  for (const l of lines) {
    const m = lineMoney(l, vatRate);
    if (!m) { unpricedLines++; continue; }
    subtotal = subtotal.plus(m.subtotal);
    vat = vat.plus(m.vat);
    discount = discount.plus(m.discount);
  }
  return { subtotal: money(subtotal), vat: money(vat), net: money(subtotal.plus(vat)), unpricedLines, discount: money(discount) };
}

/** The order with each line's subtotal, VAT and net, and the order totals. */
export function withTotals<L extends Priceable, P extends { vatRate?: Num | null; lines: L[] }>(po: P) {
  const rate = po.vatRate ?? 0;
  return {
    ...po,
    lines: po.lines.map((l) => ({ ...l, ...(lineMoney(l, rate) ?? { subtotal: null, vat: null, net: null, discount: null }) })),
    totals: orderTotals(po.lines, rate),
  };
}
