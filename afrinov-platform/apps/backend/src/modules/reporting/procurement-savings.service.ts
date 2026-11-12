// The Procurement savings report: for each line of a Procurement RFQ sent in a
// period, what suppliers quoted the buyers and what the order was placed at,
// with the difference between the two.
//
// All excl. VAT, as line totals. Every quote is listed by supplier and compared
// at its lowest. The order is at its price before line discounts, which are
// asked for once a price is awarded and shown on their own. Only rand is
// compared, and a figure that can't be compared (a quantity that differs, an
// order in another currency) is left blank and out of the totals, with a note
// saying why, rather than being compared wrongly.
//
// Sales no longer has a column: a Sales RFQ takes its material cost from these
// same orders (sales-rfq.service.ts), so there is nothing of its own to compare.
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
  procurement: { prices: SavingsPrice[]; lowest: string | null };
  order: {
    number: string; status: string; supplier: string; currency: string; quantity: string; unitPrice: string | null;
    /** Before the line's discount. */
    lineTotal: string | null;
    discountPercent: string;
    discount: string | null;
  } | null;
  /** Positive where the order is the lower. Null where they can't be compared. */
  procurementVsOrder: string | null;
  /** Why a figure is blank or left out, in words. */
  notes: string[];
}

export interface SavingsReport {
  from: string;
  to: string;
  currency: string;
  rows: SavingsRow[];
  total: {
    procurement: string; order: string; discount: string;
    procurementVsOrder: string;
    lines: number;
  };
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
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

/** One line's own figures. */
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

/** The report's rows and totals. */
export function buildSavingsReport(rfqs: SavingsRfq[], range: { from: string; to: string }): SavingsReport {
  const totals = { procurement: [] as string[], order: [] as string[], discount: [] as string[], procurementVsOrder: [] as string[] };
  const rows = rfqs.flatMap((rfq) => {
    const pairs = orderLinesFor(rfq);
    return rfq.lines.map((line): SavingsRow => {
      const own = figures(rfq, line, pairs.get(line.id));
      const notes = [...own.notes];
      const procurementLow = own.procurement.lowest;
      const procurementVsOrder = procurementLow && own.comparable ? D(procurementLow).minus(own.comparable).toFixed(2) : null;
      if (procurementLow) totals.procurement.push(procurementLow);
      if (own.comparable) totals.order.push(own.comparable);
      if (procurementVsOrder) totals.procurementVsOrder.push(procurementVsOrder);
      // Over the same lines as the order total, so the two can be read together.
      if (own.order?.discount && own.comparable) totals.discount.push(own.order.discount);
      if (!rfq.purchaseOrder) notes.push('Not awarded yet, so there is no order to compare');
      return {
        rfqId: rfq.id, rfqNumber: rfq.number, rfqStatus: rfq.status, projectNumber: rfq.projectNumber, projectName: rfq.project?.name ?? null,
        lineNo: line.lineNo, sku: line.material.sku, material: line.material.name, unitOfMeasure: line.material.unitOfMeasure, quantity: line.quantity.toString(),
        procurement: { prices: own.procurement.prices, lowest: procurementLow }, order: own.order, procurementVsOrder, notes,
      };
    });
  });

  const sum = (values: string[]) => add(values).toFixed(2);
  return {
    from: range.from, to: range.to, currency: CURRENCY, rows,
    total: {
      procurement: sum(totals.procurement), order: sum(totals.order), discount: sum(totals.discount),
      procurementVsOrder: sum(totals.procurementVsOrder), lines: rows.length,
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
    return buildSavingsReport(rfqs, { from, to });
  },
};
