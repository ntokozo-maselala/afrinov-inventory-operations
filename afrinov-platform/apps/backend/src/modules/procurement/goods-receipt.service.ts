import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
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

export const GoodsReceiptService = {
  async list() {
    return prisma.goodsReceipt.findMany({
      include: { supplier: true, lines: { include: { material: true, location: true } } },
      orderBy: { receivedAt: 'desc' },
    });
  },

  async getById(id: string) {
    const gr = await prisma.goodsReceipt.findUnique({
      where: { id },
      include: { supplier: true, lines: { include: { material: true, location: true } } },
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
      const po = await prisma.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId } });
      if (!po) throw Errors.notFound('PurchaseOrder');
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

async function generateGRNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const count = await tx.goodsReceipt.count({
    where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
  });
  return `GR-${year}-${String(count + 1).padStart(4, '0')}`;
}