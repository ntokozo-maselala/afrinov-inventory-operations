// Money on a purchase order, worked out in one place so every screen and
// export shows the same figures. As on the AFRI-0000_x template, per line:
// subtotal = unit price x quantity, VAT = subtotal x rate, net = subtotal + VAT,
// and the order totals are the sums of the lines. Each line is rounded to
// cents (half up) before summing, as the template's printed lines are.
import { Prisma } from '@prisma/client';

type Num = Prisma.Decimal | number | string;
type Priceable = { orderedQty: Num; unitPrice?: Num | null };

const D = (v: Num) => new Prisma.Decimal(v);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const money = (d: Prisma.Decimal) => d.toFixed(2);

/** VAT for a new order: the setting for rand suppliers, 0% for other currencies. */
export function defaultVatRate(currency: string, settingRate: number): number {
  return currency === 'ZAR' ? settingRate : 0;
}

export interface LineMoney { subtotal: string; vat: string; net: string }

export interface OrderTotals {
  subtotal: string;
  vat: string;
  net: string;
  /** Lines without a price, left out of the totals. */
  unpricedLines: number;
}

export function lineMoney(line: Priceable, vatRate: Num): LineMoney | null {
  if (line.unitPrice === null || line.unitPrice === undefined) return null;
  const subtotal = cents(D(line.unitPrice).times(D(line.orderedQty)));
  const vat = cents(subtotal.times(D(vatRate)).dividedBy(100));
  return { subtotal: money(subtotal), vat: money(vat), net: money(subtotal.plus(vat)) };
}

export function orderTotals(lines: Priceable[], vatRate: Num): OrderTotals {
  let subtotal = new Prisma.Decimal(0);
  let vat = new Prisma.Decimal(0);
  let unpricedLines = 0;
  for (const l of lines) {
    const m = lineMoney(l, vatRate);
    if (!m) { unpricedLines++; continue; }
    subtotal = subtotal.plus(m.subtotal);
    vat = vat.plus(m.vat);
  }
  return { subtotal: money(subtotal), vat: money(vat), net: money(subtotal.plus(vat)), unpricedLines };
}

/** The order with each line's subtotal, VAT and net, and the order totals. */
export function withTotals<L extends Priceable, P extends { vatRate?: Num | null; lines: L[] }>(po: P) {
  const rate = po.vatRate ?? 0;
  return {
    ...po,
    lines: po.lines.map((l) => ({ ...l, ...(lineMoney(l, rate) ?? { subtotal: null, vat: null, net: null }) })),
    totals: orderTotals(po.lines, rate),
  };
}
