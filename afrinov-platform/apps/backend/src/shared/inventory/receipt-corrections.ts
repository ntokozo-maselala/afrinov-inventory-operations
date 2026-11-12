// Putting a receipt against an order right (system audit A6, A7, ADR-040).
// A receipt line booked wrong is reversed; goods sent back go off as a return
// to the supplier. Either way the order line's received quantity goes down, so
// the order shows the goods as owed again and reopens. Shared by the reversal
// (InventoryService.reverse) and the return (SupplierReturnService).
import { InventoryTransactionType, Prisma, type PurchaseOrderStatus } from '@prisma/client';
import { Errors } from '../errors.js';

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

/**
 * The receipt line a RECEIPT movement posted: recorded on the line since
 * ADR-040; for one posted before, the only line of that receipt for the same
 * item, location and quantity. Null when it can't be told.
 */
export async function lineOfReceipt(tx: Tx, receipt: { id: string; materialId: string; locationId: string; quantity: Prisma.Decimal; referenceId: string | null }) {
  const byLink = await tx.goodsReceiptLine.findFirst({ where: { transactionId: receipt.id } });
  if (byLink) return byLink;
  if (!receipt.referenceId) return null;
  const candidates = await tx.goodsReceiptLine.findMany({
    where: { goodsReceiptId: receipt.referenceId, materialId: receipt.materialId, locationId: receipt.locationId, quantity: receipt.quantity, transactionId: null },
  });
  return candidates.length === 1 ? candidates[0]! : null;
}

/** The RECEIPT movement a receipt line posted, as lineOfReceipt finds it the other way. */
export async function receiptOfLine(tx: Tx, line: { id: string; goodsReceiptId: string; materialId: string; locationId: string; quantity: Prisma.Decimal; transactionId: string | null }) {
  const include = { reversedBy: { select: { id: true } } } as const;
  if (line.transactionId) return tx.inventoryTransaction.findUnique({ where: { id: line.transactionId }, include });
  const candidates = await tx.inventoryTransaction.findMany({
    where: { type: InventoryTransactionType.RECEIPT, referenceType: 'GoodsReceipt', referenceId: line.goodsReceiptId, materialId: line.materialId, locationId: line.locationId, quantity: line.quantity, reversesId: null },
    include,
  });
  // Without the link, only a line that is the receipt's only one like it can be told apart.
  const twins = await tx.goodsReceiptLine.count({ where: { goodsReceiptId: line.goodsReceiptId, materialId: line.materialId, locationId: line.locationId, quantity: line.quantity } });
  return candidates.length === 1 && twins === 1 ? candidates[0]! : null;
}

/** How much of a receipt line has gone back to the supplier. */
export async function returnedOn(tx: Tx, lineId: string): Promise<Prisma.Decimal> {
  const agg = await tx.supplierReturn.aggregate({ where: { goodsReceiptLineId: lineId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? ZERO;
}

/**
 * Holds the order and its line, in the order receiving takes them (the order,
 * its lines, then stock), so a correction and a delivery wait for each other.
 */
export async function lockOrderLine(tx: Tx, purchaseOrderId: string, purchaseOrderLineId: string | null): Promise<void> {
  await tx.$executeRaw`SELECT id FROM purchase_orders WHERE id = ${purchaseOrderId} FOR UPDATE`;
  if (purchaseOrderLineId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`afrinov:purchase-order-line:${purchaseOrderLineId}`}))`;
}

/**
 * Lowers an order line's received quantity, and moves a received or partly
 * received order back to what its lines now say: owed again. A closed or
 * cancelled order keeps its status. Written on the order's Activity.
 */
export async function lowerReceived(
  tx: Tx, order: { purchaseOrderId: string; purchaseOrderLineId: string; quantity: Prisma.Decimal },
  entry: { actorId: string; action: 'PO_RECEIPT_REVERSED' | 'PO_RETURNED_TO_SUPPLIER'; goodsReceiptId: string; goodsReceiptNumber: string; reason: string },
): Promise<PurchaseOrderStatus> {
  const line = await tx.purchaseOrderLine.findUnique({ where: { id: order.purchaseOrderLineId } });
  if (!line) throw Errors.notFound('PurchaseOrderLine');
  if (line.receivedQty.lt(order.quantity)) throw Errors.invalidState('The order line shows less received than this would take off. Refresh and check the order.');
  await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty.minus(order.quantity) } });
  const po = (await tx.purchaseOrder.findUnique({ where: { id: order.purchaseOrderId }, select: { status: true } }))!;
  let status = po.status;
  if (status === 'RECEIVED' || status === 'PARTIALLY_RECEIVED') {
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: order.purchaseOrderId } });
    const allFully = lines.every((l) => l.receivedQty.gte(l.orderedQty));
    const anyReceived = lines.some((l) => l.receivedQty.gt(0));
    status = allFully ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'APPROVED';
    if (status !== po.status) {
      await tx.purchaseOrder.update({
        where: { id: order.purchaseOrderId },
        data: { status, ...(status === 'RECEIVED' ? {} : { deliveredAt: null, deliveredById: null }) },
      });
    }
  }
  await tx.auditLogEntry.create({
    data: {
      actorId: entry.actorId, action: entry.action, entityType: 'PurchaseOrder', entityId: order.purchaseOrderId,
      before: { status: po.status } as Prisma.InputJsonValue,
      after: { status, goodsReceiptId: entry.goodsReceiptId, goodsReceiptNumber: entry.goodsReceiptNumber, lineId: order.purchaseOrderLineId, quantity: order.quantity.toString(), reason: entry.reason } as Prisma.InputJsonValue,
    },
  });
  return status;
}
