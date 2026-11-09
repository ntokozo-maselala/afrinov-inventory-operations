// The Procurement savings report: for each line of a Procurement RFQ sent in a
// period, what suppliers quoted Sales, what they quoted the buyers, and what the
// order was placed at, with the differences between the three.
//
// All excl. VAT, as line totals. Every quote is listed by supplier; each side is
// compared at its lowest. The order is at its price before line discounts, which
// are asked for once a price is awarded and shown on their own. Only rand is
// compared, and a figure that can't be compared (a quantity or unit that differs,
// a Sales RFQ that was cancelled) is left blank and out of the totals, with a
// note saying why, rather than being compared wrongly.
//
// Lines sharing a Sales line are added up and compared with it together, once, on
// the first of them in the report, so its price isn't counted again for each.
// Lines sharing it on an RFQ outside the period or project chosen still count:
// otherwise the same Sales line would look cheaper or dearer by the filter.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { lineMoney } from '../procurement/po-pricing.js';
import { parseRange } from './consumption.service.js';

const CURRENCY = 'ZAR';

/** Each line brings every quote with it, so a selection larger than this is refused rather than loaded. */
export const MAX_SAVINGS_LINES = 2000;

const QUOTE = { select: { supplierId: true, currency: true, declined: true, quotedAt: true, supplier: { select: { name: true, currency: true } } } } as const;

const SAVINGS_RFQ = {
  project: { select: { name: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      material: { select: { sku: true, name: true, unitOfMeasure: true } },
      prices: { include: { rfqSupplier: QUOTE } },
      salesRfqLine: { include: { rfq: { select: { number: true, status: true } }, prices: { include: { rfqSupplier: QUOTE } } } },
    },
  },
  purchaseOrder: {
    select: {
      number: true, status: true, currency: true, supplierId: true, supplier: { select: { name: true } },
      lines: { orderBy: { id: 'asc' }, select: { id: true, materialId: true, orderedQty: true, unitPrice: true, discountPercent: true } },
    },
  },
} satisfies Prisma.RfqInclude;

export type SavingsRfq = Prisma.RfqGetPayload<{ include: typeof SAVINGS_RFQ }>;
type SavingsLine = SavingsRfq['lines'][number];
type QuotedPrice = { unitPrice: Prisma.Decimal; rfqSupplier: Prisma.RfqSupplierGetPayload<{ select: typeof QUOTE.select }> };

export interface SavingsPrice { supplier: string; currency: string; unitPrice: string; lineTotal: string }

export interface SavingsRow {
  rfqId: string;
  rfqNumber: string;
  rfqStatus: string;
  projectNumber: string | null;
  projectName: string | null;
  lineNo: number;
  sku: string;
  material: string;
  unitOfMeasure: string;
  quantity: string;
  sales: {
    rfqNumber: string; lineNo: number; description: string; unitOfMeasure: string; quantity: string; cancelled: boolean;
    prices: SavingsPrice[];
    /** The lowest rand line total. */
    lowest: string | null;
  } | null;
  procurement: { prices: SavingsPrice[]; lowest: string | null };
  order: {
    number: string; status: string; supplier: string; currency: string; quantity: string; unitPrice: string | null;
    /** Before the line's discount. */
    lineTotal: string | null;
    discountPercent: string;
    discount: string | null;
  } | null;
  /** Each positive where the second figure is the lower. Null where they can't be compared. */
  salesVsProcurement: string | null;
  procurementVsOrder: string | null;
  salesVsOrder: string | null;
  /**
   * On the first row of a Sales line other lines share, when it is compared:
   * what the Sales price was set against, all of those lines together.
   */
  comparedWith: { lines: number; quantity: string; unitOfMeasure: string; procurement: string | null; order: string | null } | null;
  /** Why a figure is blank or left out, in words. */
  notes: string[];
}

export interface SavingsReport {
  from: string;
  to: string;
  currency: string;
  rows: SavingsRow[];
  total: {
    sales: string; procurement: string; order: string; discount: string;
    salesVsProcurement: string; procurementVsOrder: string; salesVsOrder: string;
    lines: number;
    linked: number;
  };
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const qtyLabel = (q: Prisma.Decimal.Value, unit: string) => `${D(q).toString()} ${unit}`;
const sameUnit = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const add = (values: string[]) => values.reduce((sum, v) => sum.plus(v), D(0));
const lineTotal = (quantity: Prisma.Decimal, unitPrice: Prisma.Decimal.Value) => lineMoney({ orderedQty: quantity, unitPrice }, 0)!.subtotal;

/** Each answered quote's price for a line, by supplier, and the lowest in rand. */
function quotesFor(prices: QuotedPrice[], quantity: Prisma.Decimal): { prices: SavingsPrice[]; lowest: string | null; foreignOnly: boolean } {
  const listed = prices
    .filter((p) => p.rfqSupplier.quotedAt && !p.rfqSupplier.declined)
    .map((p) => ({
      supplier: p.rfqSupplier.supplier.name,
      currency: p.rfqSupplier.currency ?? p.rfqSupplier.supplier.currency ?? CURRENCY,
      unitPrice: p.unitPrice.toString(),
      lineTotal: lineTotal(quantity, p.unitPrice),
    }))
    .sort((a, b) => a.supplier.localeCompare(b.supplier));
  const rand = listed.filter((p) => p.currency === CURRENCY).map((p) => p.lineTotal);
  const lowest = rand.length ? rand.reduce((low, v) => (D(v).lessThan(low) ? v : low)) : null;
  return { prices: listed, lowest, foreignOnly: listed.length > 0 && rand.length === 0 };
}

/**
 * Pairs an RFQ's lines with its order's. An order has no line numbers and can
 * have the same item twice, so the closest match goes first: the same quantity
 * at the price the supplier awarded quoted for that line, then the same
 * quantity, then the item alone.
 */
function orderLinesFor(rfq: SavingsRfq) {
  const po = rfq.purchaseOrder;
  const left = [...(po?.lines ?? [])];
  type OrderLine = (typeof left)[number];
  const pairs = new Map<string, OrderLine>();
  const sameQty = (l: SavingsLine, o: OrderLine) => o.orderedQty.equals(l.quantity);
  const asQuoted = (l: SavingsLine, o: OrderLine) => {
    const quoted = l.prices.find((p) => p.rfqSupplier.supplierId === po?.supplierId)?.unitPrice;
    return sameQty(l, o) && !!quoted && !!o.unitPrice?.equals(quoted);
  };
  for (const closeEnough of [asQuoted, sameQty, () => true]) {
    for (const l of rfq.lines) {
      if (pairs.has(l.id)) continue;
      const i = left.findIndex((o) => o.materialId === l.materialId && closeEnough(l, o));
      if (i >= 0) pairs.set(l.id, left.splice(i, 1)[0]!);
    }
  }
  return pairs;
}

/** One line's own figures, for the report or for a line sharing its Sales line. */
function figures(rfq: SavingsRfq, line: SavingsLine, orderLine: ReturnType<typeof orderLinesFor> extends Map<string, infer O> ? O | undefined : never) {
  const procurement = quotesFor(line.prices, line.quantity);
  const notes: string[] = [];
  if (procurement.foreignOnly) notes.push('Procurement quotes are not in rand, so they are not compared');
  const po = rfq.purchaseOrder;
  let order: SavingsRow['order'] = null;
  /** The order's line total, where it can be compared with this line in rand. */
  let comparable: string | null = null;
  if (po?.status === 'CANCELLED') {
    notes.push(`Order ${po.number} was cancelled`);
  } else if (po && !orderLine) {
    notes.push(`Not on order ${po.number}`);
  } else if (po && orderLine) {
    const list = orderLine.unitPrice ? lineTotal(orderLine.orderedQty, orderLine.unitPrice) : null;
    const money = orderLine.unitPrice ? lineMoney({ orderedQty: orderLine.orderedQty, unitPrice: orderLine.unitPrice, discountPercent: orderLine.discountPercent }, 0) : null;
    order = {
      number: po.number, status: po.status, supplier: po.supplier.name, currency: po.currency, quantity: orderLine.orderedQty.toString(),
      unitPrice: orderLine.unitPrice?.toString() ?? null, lineTotal: list, discountPercent: orderLine.discountPercent.toString(), discount: money?.discount ?? null,
    };
    if (!list) notes.push(`Order ${po.number} has no price on this line`);
    else if (po.currency !== CURRENCY) notes.push(`Order ${po.number} is in ${po.currency}, so it is not compared`);
    else if (!orderLine.orderedQty.equals(line.quantity)) notes.push(`Order ${po.number} is for ${orderLine.orderedQty.toString()}, the RFQ for ${line.quantity.toString()}, so they are not compared`);
    else comparable = list;
  }
  return { procurement, order, comparable, notes };
}

/**
 * The report's rows and totals. `rfqs` are the RFQs asked for; `others` hold any
 * further lines sharing their Sales lines.
 */
export function buildSavingsReport(rfqs: SavingsRfq[], others: SavingsRfq[], range: { from: string; to: string }): SavingsReport {
  const worked = new Map<string, ReturnType<typeof figures>>();
  const sharing = new Map<string, SavingsLine[]>();
  for (const rfq of [...rfqs, ...others]) {
    const pairs = orderLinesFor(rfq);
    for (const line of rfq.lines) {
      worked.set(line.id, figures(rfq, line, pairs.get(line.id)));
      if (line.salesRfqLineId) sharing.set(line.salesRfqLineId, [...(sharing.get(line.salesRfqLineId) ?? []), line]);
    }
  }

  const seen = new Set<string>();
  const totals = { sales: [] as string[], procurement: [] as string[], order: [] as string[], discount: [] as string[], salesVsProcurement: [] as string[], procurementVsOrder: [] as string[], salesVsOrder: [] as string[] };
  let linked = 0;
  const rows = rfqs.flatMap((rfq) => rfq.lines.map((line): SavingsRow => {
    const own = worked.get(line.id)!;
    const notes = [...own.notes];
    const procurementLow = own.procurement.lowest;
    const procurementVsOrder = procurementLow && own.comparable ? D(procurementLow).minus(own.comparable).toFixed(2) : null;

    let sales: SavingsRow['sales'] = null;
    let salesVsProcurement: string | null = null;
    let salesVsOrder: string | null = null;
    let comparedWith: SavingsRow['comparedWith'] = null;
    const asked = line.salesRfqLine;
    if (!asked) {
      notes.push('Not linked to a Sales line');
    } else {
      linked += 1;
      const quoted = quotesFor(asked.prices, asked.quantity);
      const cancelled = asked.rfq.status === 'CANCELLED';
      sales = {
        rfqNumber: asked.rfq.number, lineNo: asked.lineNo, description: asked.description, unitOfMeasure: asked.unitOfMeasure,
        quantity: asked.quantity.toString(), cancelled, prices: quoted.prices, lowest: quoted.lowest,
      };
      const group = sharing.get(asked.id) ?? [line];
      const units = group.every((l) => sameUnit(l.material.unitOfMeasure, asked.unitOfMeasure));
      const matches = units && group.reduce((sum, l) => sum.plus(l.quantity), D(0)).equals(asked.quantity);
      const first = !seen.has(asked.id);
      seen.add(asked.id);

      if (cancelled) notes.push(`Sales RFQ ${asked.rfq.number} was cancelled, so it is not compared`);
      else if (!matches) notes.push(`Sales asked for ${qtyLabel(asked.quantity, asked.unitOfMeasure)}, so it is not compared: the lines linked to it come to ${units ? qtyLabel(group.reduce((sum, l) => sum.plus(l.quantity), D(0)), asked.unitOfMeasure) : 'a different unit'}`);
      else if (quoted.foreignOnly) notes.push('Sales quotes are not in rand, so they are not compared');
      else if (!quoted.lowest) notes.push('No Sales quote recorded yet');
      // Only a comparison that is made is said to be made together.
      const compared = !cancelled && matches && !!quoted.lowest;
      if (group.length > 1) notes.push(`Shares its Sales line with ${group.length - 1} other line${group.length === 2 ? '' : 's'}${compared ? `: compared together${first ? ' here' : ', on the first of them'}` : ''}`);

      if (compared && quoted.lowest && first) {
        totals.sales.push(quoted.lowest);
        let procurementTogether: string | null = null;
        let orderTogether: string | null = null;
        const lows = group.map((l) => worked.get(l.id)!.procurement.lowest);
        if (lows.every((v): v is string => v !== null)) {
          procurementTogether = add(lows).toFixed(2);
          salesVsProcurement = D(quoted.lowest).minus(procurementTogether).toFixed(2);
          totals.salesVsProcurement.push(salesVsProcurement);
        }
        const placed = group.map((l) => worked.get(l.id)!.comparable);
        if (placed.every((v): v is string => v !== null)) {
          orderTogether = add(placed).toFixed(2);
          salesVsOrder = D(quoted.lowest).minus(orderTogether).toFixed(2);
          totals.salesVsOrder.push(salesVsOrder);
        }
        if (group.length > 1) {
          comparedWith = {
            lines: group.length, quantity: asked.quantity.toString(), unitOfMeasure: asked.unitOfMeasure,
            procurement: procurementTogether, order: orderTogether,
          };
        }
      }
    }

    if (procurementLow) totals.procurement.push(procurementLow);
    if (own.comparable) totals.order.push(own.comparable);
    if (procurementVsOrder) totals.procurementVsOrder.push(procurementVsOrder);
    // Over the same lines as the order total, so the two can be read together.
    if (own.order?.discount && own.comparable) totals.discount.push(own.order.discount);
    if (!rfq.purchaseOrder) notes.push('Not awarded yet, so there is no order to compare');

    return {
      rfqId: rfq.id, rfqNumber: rfq.number, rfqStatus: rfq.status, projectNumber: rfq.projectNumber, projectName: rfq.project?.name ?? null,
      lineNo: line.lineNo, sku: line.material.sku, material: line.material.name, unitOfMeasure: line.material.unitOfMeasure, quantity: line.quantity.toString(),
      sales, procurement: { prices: own.procurement.prices, lowest: procurementLow }, order: own.order,
      salesVsProcurement, procurementVsOrder, salesVsOrder, comparedWith, notes,
    };
  }));

  const sum = (values: string[]) => add(values).toFixed(2);
  return {
    from: range.from, to: range.to, currency: CURRENCY, rows,
    total: {
      sales: sum(totals.sales), procurement: sum(totals.procurement), order: sum(totals.order), discount: sum(totals.discount),
      salesVsProcurement: sum(totals.salesVsProcurement), procurementVsOrder: sum(totals.procurementVsOrder), salesVsOrder: sum(totals.salesVsOrder),
      lines: rows.length, linked,
    },
  };
}

export const ProcurementSavingsService = {
  /**
   * The RFQs sent to suppliers in the period, drafts and cancelled ones aside.
   *
   * @throws {ApiError} VALIDATION_ERROR for a bad period, or more lines than
   * MAX_SAVINGS_LINES.
   */
  async report(q: { from?: string; to?: string; projectNumber?: string }): Promise<SavingsReport> {
    const { from, to, start, end } = parseRange(q.from, q.to);
    const counted = { status: { in: ['SENT', 'AWARDED'] } } satisfies Prisma.RfqWhereInput;
    const chosen = {
      ...counted,
      issuedAt: { gte: start, lt: end },
      ...(q.projectNumber ? { projectNumber: q.projectNumber } : {}),
    } satisfies Prisma.RfqWhereInput;
    const lines = await prisma.rfqLine.count({ where: { rfq: chosen } });
    if (lines > MAX_SAVINGS_LINES) {
      throw Errors.validation(`That is ${lines} lines, more than the ${MAX_SAVINGS_LINES} this report can show at once. Choose a shorter period or one project.`);
    }
    const rfqs = await prisma.rfq.findMany({
      where: chosen,
      include: SAVINGS_RFQ,
      orderBy: [{ projectNumber: 'asc' }, { number: 'asc' }],
    });
    const salesLines = [...new Set(rfqs.flatMap((r) => r.lines.flatMap((l) => (l.salesRfqLineId ? [l.salesRfqLineId] : []))))];
    const others = salesLines.length === 0 ? [] : await prisma.rfq.findMany({
      where: { ...counted, id: { notIn: rfqs.map((r) => r.id) }, lines: { some: { salesRfqLineId: { in: salesLines } } } },
      include: SAVINGS_RFQ,
    });
    return buildSavingsReport(rfqs, others, { from, to });
  },
};
