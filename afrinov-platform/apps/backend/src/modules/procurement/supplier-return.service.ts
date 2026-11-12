// Goods sent back to the supplier (system audit A6, ADR-040): against a line
// of a posted receipt, with a reason and the supplier's reference. The stock
// goes off as a RETURN_TO_SUPPLIER movement, not a loss, so it needs no
// write-off approval; against an order, the line's received quantity goes down
// and the order owes the goods again.
import { InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal } from '../../shared/decimal.js';
import { checkWholeUnits } from '../../shared/units.js';
import { getCurrentBalance, lockInventoryBalances, recomputeBalance } from '../../shared/inventory/balances.js';
import { lockOrderLine, lowerReceived, receiptOfLine, returnedOn } from '../../shared/inventory/receipt-corrections.js';
import { checkMaterialActive } from '../inventory/inventory.service.js';

type Tx = Prisma.TransactionClient;

export interface SupplierReturnInput {
  goodsReceiptId: string;
  lineId: string;
  quantity: number | string;
  reason: string;
  supplierReference?: string;
  actorId: string;
}

export const SupplierReturnService = {
  async returnToSupplier(input: SupplierReturnInput, outer?: Tx): Promise<{ id: string; transactionId: string; orderStatus: string | null }> {
    const reason = input.reason.trim();
    if (!reason) throw Errors.validation('Say why the goods go back to the supplier.');
    const qty = toDecimal(input.quantity);
    if (!qty.gt(0)) throw Errors.validation('Return quantity must be positive');
    const work = async (tx: Tx) => {
      const gr = await tx.goodsReceipt.findUnique({ where: { id: input.goodsReceiptId }, include: { lines: true, purchaseOrder: { select: { projectNumber: true } } } });
      if (!gr) throw Errors.notFound('GoodsReceipt');
      const line = gr.lines.find((l) => l.id === input.lineId);
      if (!line) throw Errors.notFound('Goods receipt line');
      if (gr.status !== 'POSTED') throw Errors.invalidState('Only a posted receipt has goods to send back.');
      // The order and its line first, as receiving holds them, then the stock.
      if (gr.purchaseOrderId) await lockOrderLine(tx, gr.purchaseOrderId, line.purchaseOrderLineId);
      // A project order's delivery is held for its project, as it was received.
      const stock = { materialId: line.materialId, locationId: line.locationId, heldForProject: gr.purchaseOrder?.projectNumber ?? null };
      await lockInventoryBalances([stock], tx);
      const receipt = await receiptOfLine(tx, line);
      if (receipt?.reversedBy) throw Errors.invalidState('This receipt line was reversed: there is nothing on it to send back.');
      await checkMaterialActive(line.materialId, tx);

      const returnable = line.quantity.minus(await returnedOn(tx, line.id));
      if (qty.gt(returnable)) {
        throw Errors.validation(`Only ${returnable.toString()} of this line can go back: the rest went back already.`, { returnable: returnable.toString() });
      }
      // Whole units, except that exactly the part-unit left on the line can go back.
      await checkWholeUnits([{ materialId: line.materialId, quantity: qty, group: line.id, remainder: returnable }], tx);
      const balance = await getCurrentBalance(stock, tx);
      if (balance.lt(qty)) {
        throw Errors.insufficientBalance(`Cannot send back ${qty.toString()}: only ${balance.toString()} in stock there.`, { requested: qty.toString(), available: balance.toString() });
      }

      const supplierReference = input.supplierReference?.trim() || null;
      const movement = await tx.inventoryTransaction.create({
        data: {
          materialId: line.materialId, locationId: line.locationId, heldForProject: stock.heldForProject,
          type: InventoryTransactionType.RETURN_TO_SUPPLIER, quantity: qty.negated(),
          reasonNote: supplierReference ? `${reason} (supplier ref. ${supplierReference})` : reason,
          referenceType: 'GoodsReceipt', referenceId: gr.id, actorId: input.actorId,
        },
      });
      await recomputeBalance(stock, tx);
      const row = await tx.supplierReturn.create({
        data: { goodsReceiptLineId: line.id, quantity: qty, reason, supplierReference, transactionId: movement.id, actorId: input.actorId },
      });
      const orderStatus = gr.purchaseOrderId && line.purchaseOrderLineId
        ? await lowerReceived(tx, { purchaseOrderId: gr.purchaseOrderId, purchaseOrderLineId: line.purchaseOrderLineId, quantity: qty }, {
          actorId: input.actorId, action: 'PO_RETURNED_TO_SUPPLIER', goodsReceiptId: gr.id, goodsReceiptNumber: gr.number, reason,
        })
        : null;
      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId, action: 'RETURN_TO_SUPPLIER', entityType: 'GoodsReceipt', entityId: gr.id,
          after: { lineId: line.id, materialId: line.materialId, quantity: qty.toString(), reason, supplierReference, transactionId: movement.id, orderStatus } as Prisma.InputJsonValue,
        },
      });
      return { id: row.id, transactionId: movement.id, orderStatus };
    };
    return outer ? work(outer) : prisma.$transaction(work);
  },
};
