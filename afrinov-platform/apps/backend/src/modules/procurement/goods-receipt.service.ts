import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { RECEIVABLE_STATUSES } from './procurement.service.js';
import { InventoryService } from '../inventory/inventory.service.js';

export interface CreateGoodsReceiptInput {
  purchaseOrderId?: string;
  supplierId: string;
  deliveryRef?: string;
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
      include: { supplier: true, purchaseOrder: { select: { id: true, number: true } }, lines: { include: { material: true, location: true } } },
      orderBy: { receivedAt: 'desc' },
    });
  },

  async getById(id: string) {
    const gr = await prisma.goodsReceipt.findUnique({
      where: { id },
      include: { supplier: true, purchaseOrder: { select: { id: true, number: true } }, lines: { include: { material: true, location: true } } },
    });
    if (!gr) throw Errors.notFound('GoodsReceipt');
    return gr;
  },

  async create(input: CreateGoodsReceiptInput, actorId: string) {
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
      if (!RECEIVABLE_STATUSES.includes(po.status)) {
        throw Errors.invalidState(`Cannot receive against a purchase order in status ${po.status}`, { status: po.status });
      }
      assertLinesOnOrder(po, input);
    } else if (input.lines.some((l) => l.purchaseOrderLineId)) {
      throw Errors.validation('These lines belong to a purchase order: choose the order the delivery is for.');
    }

    return prisma.$transaction(async (tx) => {
      // Serialize GR-number generation so two concurrent creates cannot
      // collide on the same sequential number.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:gr-number'))`;
      const number = await generateGRNumber(tx);
      return tx.goodsReceipt.create({
        data: {
          number,
          purchaseOrderId: input.purchaseOrderId ?? null,
          supplierId: input.supplierId,
          deliveryRef: input.deliveryRef ?? null,
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
    });
  },

  async post(id: string, actorId: string) {
    await InventoryService.postGoodsReceipt({ goodsReceiptId: id, actorId });
    return this.getById(id);
  },
};

export async function generateGRNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const count = await tx.goodsReceipt.count({
    where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
  });
  return `GR-${year}-${String(count + 1).padStart(4, '0')}`;
}