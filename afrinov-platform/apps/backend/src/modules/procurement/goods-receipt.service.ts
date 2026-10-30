import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { PROJECT_DELIVERY_REFUSED, RECEIVABLE_STATUSES } from './procurement.service.js';
import { InventoryService } from '../inventory/inventory.service.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Slack for a client clock a little ahead of the server's. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The date on the delivery note; now when left out. A day from the date field
 * (YYYY-MM-DD) is a day in South Africa: today is booked as now, keeping the
 * time of day, so the day's receipts stay in the order they came; a later day
 * is refused; an earlier one is that day, at UTC midnight as the delivery-date
 * filters count days. A full timestamp may not be ahead of now (Qodo, PR #123).
 */
export function parseReceivedAt(value: string | undefined, now = new Date()): Date {
  if (!value) return now;
  const future = () => Errors.validation('The delivery date cannot be in the future');
  if (DATE_ONLY.test(value)) {
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
    const d = new Date(`${value}T00:00:00.000Z`);
    // 2026-02-31 parses as 3 March: refused, not moved.
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw Errors.validation('Invalid delivery date');
    if (value > today) throw future();
    return value === today ? now : d;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw Errors.validation('Invalid delivery date');
  if (d.getTime() > now.getTime() + CLOCK_SKEW_MS) throw future();
  return d;
}

export interface CreateGoodsReceiptInput {
  purchaseOrderId?: string;
  supplierId: string;
  deliveryRef?: string;
  /** The delivery date; now when left out. */
  receivedAt?: string;
  lines: Array<{
    materialId: string;
    locationId: string;
    quantity: number;
    purchaseOrderLineId?: string;
  }>;
}

type OrderForReceipt = {
  number: string;
  supplierId: string;
  lines: Array<{ id: string; materialId: string; orderedQty: Prisma.Decimal; receivedQty: Prisma.Decimal; material: { sku: string } }>;
};

/**
 * A receipt against an order credits the order's lines, so every line must
 * name the order line it is for: on this order, for the same item, and no
 * more than is still outstanding. Without this, the stock was booked but the
 * order still showed it as owed, and could be received a second time.
 */
function assertLinesOnOrder(po: OrderForReceipt, input: CreateGoodsReceiptInput): void {
  if (po.supplierId !== input.supplierId) {
    throw Errors.validation(`${po.number} is with another supplier. Choose the order's supplier, or another order.`);
  }
  const onOrder = new Map(po.lines.map((l) => [l.id, l]));
  const receiving = new Map<string, Prisma.Decimal>();
  for (const line of input.lines) {
    if (!line.purchaseOrderLineId) {
      throw Errors.validation(`Every line of a receipt against ${po.number} must name the order line it is for.`);
    }
    const orderLine = onOrder.get(line.purchaseOrderLineId);
    if (!orderLine) throw Errors.validation(`A line is not on ${po.number}.`);
    if (orderLine.materialId !== line.materialId) {
      throw Errors.validation(`That line of ${po.number} is for ${orderLine.material.sku}, not the item given.`);
    }
    receiving.set(orderLine.id, (receiving.get(orderLine.id) ?? new Prisma.Decimal(0)).plus(line.quantity));
  }
  for (const [id, qty] of receiving) {
    const orderLine = onOrder.get(id)!;
    const outstanding = orderLine.orderedQty.minus(orderLine.receivedQty);
    if (qty.gt(outstanding)) {
      throw Errors.validation(
        `Receiving ${qty.toString()} of ${orderLine.material.sku} would exceed what is still outstanding on ${po.number} (${outstanding.toString()}).`,
        { outstanding: outstanding.toString(), receiving: qty.toString() },
      );
    }
  }
}

export const GoodsReceiptService = {
  async list() {
    return prisma.goodsReceipt.findMany({
      include: { supplier: true, purchaseOrder: { select: { id: true, number: true, projectNumber: true } }, lines: { include: { material: true, location: true } } },
      orderBy: { receivedAt: 'desc' },
    });
  },

  async getById(id: string, db: Prisma.TransactionClient = prisma) {
    const gr = await db.goodsReceipt.findUnique({
      where: { id },
      include: { supplier: true, purchaseOrder: { select: { id: true, number: true, projectNumber: true } }, lines: { include: { material: true, location: true } } },
    });
    if (!gr) throw Errors.notFound('GoodsReceipt');
    return gr;
  },

  /**
   * Records a delivery. With `post`, it is also posted into stock in the same
   * transaction: if posting fails, nothing is recorded, so a failed attempt
   * leaves no unposted receipt behind. Given a transaction (an idempotent
   * request's), it writes in that one, so the receipt and the stored key
   * commit together.
   */
  async create(input: CreateGoodsReceiptInput, actorId: string, opts: { post?: boolean } = {}, outer?: Prisma.TransactionClient) {
    if (input.lines.length === 0) throw Errors.validation('Goods receipt must have at least one line');
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw Errors.notFound('Supplier');
    if (!supplier.active) throw Errors.validation('Supplier is inactive');
    if (input.purchaseOrderId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        include: { lines: { include: { material: { select: { sku: true } } } } },
      });
      if (!po) throw Errors.notFound('PurchaseOrder');
      // Project material goes to site, not into stock: its delivery is confirmed on the order.
      if (po.projectNumber != null) throw Errors.validation(PROJECT_DELIVERY_REFUSED);
      if (!RECEIVABLE_STATUSES.includes(po.status)) {
        throw Errors.invalidState(`Cannot receive against a purchase order in status ${po.status}`, { status: po.status });
      }
      assertLinesOnOrder(po, input);
    } else if (input.lines.some((l) => l.purchaseOrderLineId)) {
      throw Errors.validation('These lines belong to a purchase order: choose the order the delivery is for.');
    }

    const write = async (tx: Prisma.TransactionClient) => {
      // Serialize GR-number generation so two concurrent creates cannot
      // collide on the same sequential number. The lock is taken first and
      // held through posting, as Receive stock does: receipts then post one
      // at a time, so two cannot recompute one balance at once and lose an
      // increase, and every receipt takes its locks in the same order, so
      // none can deadlock with another.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:gr-number'))`;
      const number = await generateGRNumber(tx);
      const gr = await tx.goodsReceipt.create({
        data: {
          number,
          purchaseOrderId: input.purchaseOrderId ?? null,
          supplierId: input.supplierId,
          deliveryRef: input.deliveryRef ?? null,
          receivedAt: parseReceivedAt(input.receivedAt),
          receivedById: actorId,
          status: 'SUBMITTED',
          lines: {
            create: input.lines.map((l) => ({
              materialId: l.materialId,
              locationId: l.locationId,
              quantity: l.quantity,
              purchaseOrderLineId: l.purchaseOrderLineId ?? null,
            })),
          },
        },
        include: { lines: true },
      });
      if (opts.post) await InventoryService.postGoodsReceipt({ goodsReceiptId: gr.id, actorId }, tx);
      return gr;
    };
    return outer ? write(outer) : prisma.$transaction(write);
  },

  /** Records a delivery and posts it into stock, as one step. */
  async receive(input: CreateGoodsReceiptInput, actorId: string, tx?: Prisma.TransactionClient) {
    const gr = await this.create(input, actorId, { post: true }, tx);
    return this.getById(gr.id, tx);
  },

  async post(id: string, actorId: string) {
    await InventoryService.postGoodsReceipt({ goodsReceiptId: id, actorId });
    return this.getById(id);
  },
};

/**
 * The next number after this year's highest. Counting the year's receipts
 * instead reissued a number once a receipt was deleted, and then collided
 * with a later one. Callers hold the gr-number advisory lock.
 */
export async function generateGRNumber(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = `GR-${new Date().getFullYear()}-`;
  // Numbers past 9999 are longer, so the highest is found as a number, not as text.
  const ours = `^${prefix}[0-9]+$`;
  const [row] = await tx.$queryRaw<Array<{ last: number | null }>>`
    SELECT MAX(CAST(substring(number FROM ${prefix.length + 1}::integer) AS integer)) AS last
    FROM goods_receipts
    WHERE number ~ ${ours}`;
  return `${prefix}${String((row?.last ?? 0) + 1).padStart(4, '0')}`;
}