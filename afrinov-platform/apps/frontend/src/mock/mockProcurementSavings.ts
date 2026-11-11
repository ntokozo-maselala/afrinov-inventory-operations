// Frontend-only mode's Procurement savings report, as procurement-savings.service.ts:
// the same rows, comparisons, notes and totals from the mock's RFQs and orders.
import type { SavingsPrice, SavingsReport, SavingsRow } from '../api/reportTypes';
import type { MockPurchaseOrder, MockRfq } from './types';

const CURRENCY = 'ZAR';
type Line = MockRfq['lines'][number];

export interface SavingsData {
  rfqs: MockRfq[];
  purchaseOrders: MockPurchaseOrder[];
  material: (id: string) => { sku: string; name: string; unitOfMeasure: string } | undefined;
  supplier: (id: string) => { name: string; currency?: string } | undefined;
  projectName: (projectNumber: string) => string | null | undefined;
}

const money = (n: number) => n.toFixed(2);
const lineTotal = (quantity: string | number, unitPrice: string | number) => money(Math.round(Number(quantity) * Number(unitPrice) * 100) / 100);
const addUp = (values: string[]) => values.reduce((sum, v) => sum + Number(v), 0);
const qty = (q: string | number) => String(Number(q));

function quotesFor(rfq: MockRfq, line: Line, data: SavingsData): { prices: SavingsPrice[]; lowest: string | null; foreignOnly: boolean } {
  const prices = rfq.suppliers.flatMap((s) => {
    const price = s.prices.find((p) => p.rfqLineId === line.id);
    if (!price || !s.quotedAt || s.declined) return [];
    const supplier = data.supplier(s.supplierId);
    return [{ supplier: supplier?.name ?? s.supplierId, currency: s.currency ?? supplier?.currency ?? CURRENCY, unitPrice: String(Number(price.unitPrice)), lineTotal: lineTotal(line.quantity, price.unitPrice) }];
  }).sort((a, b) => a.supplier.localeCompare(b.supplier));
  const rand = prices.filter((p) => p.currency === CURRENCY).map((p) => p.lineTotal);
  const lowest = rand.length ? rand.reduce((low, v) => (Number(v) < Number(low) ? v : low)) : null;
  return { prices, lowest, foreignOnly: prices.length > 0 && rand.length === 0 };
}

/** One line's own figures; as the server, the same item twice on an order is paired by quantity and the price quoted first. */
function figuresOf(rfq: MockRfq, data: SavingsData) {
  const po = rfq.purchaseOrderId ? data.purchaseOrders.find((o) => o.id === rfq.purchaseOrderId) : undefined;
  const left = [...(po?.lines ?? [])];
  const pairs = new Map<string, (typeof left)[number]>();
  type OrderLine = (typeof left)[number];
  const sameQty = (l: Line, o: OrderLine) => Number(o.orderedQty) === Number(l.quantity);
  const asQuoted = (l: Line, o: OrderLine) => {
    const quoted = rfq.suppliers.find((s) => s.supplierId === po?.supplierId)?.prices.find((p) => p.rfqLineId === l.id)?.unitPrice;
    return sameQty(l, o) && quoted !== undefined && o.unitPrice !== null && o.unitPrice !== undefined && Number(o.unitPrice) === Number(quoted);
  };
  for (const closeEnough of [asQuoted, sameQty, () => true]) {
    for (const l of rfq.lines) {
      if (pairs.has(l.id)) continue;
      const i = left.findIndex((o) => o.materialId === l.materialId && closeEnough(l, o));
      if (i >= 0) pairs.set(l.id, left.splice(i, 1)[0]!);
    }
  }

  return rfq.lines.map((line) => {
    const procurement = quotesFor(rfq, line, data);
    const notes: string[] = [];
    if (procurement.foreignOnly) notes.push('Procurement quotes are not in rand, so they are not compared');
    let order: SavingsRow['order'] = null;
    let comparable: string | null = null;
    const paired = pairs.get(line.id);
    if (po?.status === 'CANCELLED') notes.push(`Order ${po.number} was cancelled`);
    else if (po && !paired) notes.push(`Not on order ${po.number}`);
    else if (po && paired) {
      const currency = po.currency ?? CURRENCY;
      const hasPrice = paired.unitPrice !== null && paired.unitPrice !== undefined;
      const list = hasPrice ? lineTotal(paired.orderedQty, paired.unitPrice!) : null;
      const percent = Number(paired.discountPercent ?? 0);
      const discount = list === null ? null : money(Math.round(Number(list) * percent) / 100);
      order = {
        number: po.number, status: po.status, supplier: data.supplier(po.supplierId)?.name ?? po.supplierId, currency, quantity: qty(paired.orderedQty),
        unitPrice: hasPrice ? String(Number(paired.unitPrice)) : null, lineTotal: list, discountPercent: String(percent), discount,
      };
      if (!list) notes.push(`Order ${po.number} has no price on this line`);
      else if (currency !== CURRENCY) notes.push(`Order ${po.number} is in ${currency}, so it is not compared`);
      else if (Number(paired.orderedQty) !== Number(line.quantity)) notes.push(`Order ${po.number} is for ${qty(paired.orderedQty)}, the RFQ for ${qty(line.quantity)}, so they are not compared`);
      else comparable = list;
    }
    return { line, procurement, order, comparable, notes };
  });
}

export function computeProcurementSavings(q: { from: string; to: string; projectNumber?: string }, data: SavingsData): SavingsReport {
  const shown = data.rfqs
    .filter((r) => r.status === 'SENT' || r.status === 'AWARDED')
    .filter((r) => { const day = r.issuedAt?.slice(0, 10) ?? ''; return day >= q.from && day <= q.to && (!q.projectNumber || r.projectNumber === q.projectNumber); })
    .sort((a, b) => (a.projectNumber ?? '').localeCompare(b.projectNumber ?? '') || a.number.localeCompare(b.number));

  const totals = { procurement: [] as string[], order: [] as string[], discount: [] as string[], procurementVsOrder: [] as string[] };
  const rows = shown.flatMap((rfq) => figuresOf(rfq, data).map((own): SavingsRow => {
    const { line } = own;
    const notes = [...own.notes];
    const material = data.material(line.materialId);
    const low = own.procurement.lowest;
    const procurementVsOrder = low && own.comparable ? money(Number(low) - Number(own.comparable)) : null;
    if (low) totals.procurement.push(low);
    if (own.comparable) totals.order.push(own.comparable);
    if (procurementVsOrder) totals.procurementVsOrder.push(procurementVsOrder);
    if (own.order?.discount && own.comparable) totals.discount.push(own.order.discount);
    if (!rfq.purchaseOrderId) notes.push('Not awarded yet, so there is no order to compare');
    return {
      rfqId: rfq.id, rfqNumber: rfq.number, rfqStatus: rfq.status, projectNumber: rfq.projectNumber, projectName: rfq.projectNumber ? data.projectName(rfq.projectNumber) ?? null : null,
      lineNo: line.lineNo, sku: material?.sku ?? line.materialId, material: material?.name ?? line.materialId, unitOfMeasure: material?.unitOfMeasure ?? '', quantity: qty(line.quantity),
      procurement: { prices: own.procurement.prices, lowest: low }, order: own.order, procurementVsOrder, notes,
    };
  }));

  const sum = (values: string[]) => money(addUp(values));
  return {
    from: q.from, to: q.to, currency: CURRENCY, rows,
    total: { procurement: sum(totals.procurement), order: sum(totals.order), discount: sum(totals.discount), procurementVsOrder: sum(totals.procurementVsOrder), lines: rows.length },
  };
}
