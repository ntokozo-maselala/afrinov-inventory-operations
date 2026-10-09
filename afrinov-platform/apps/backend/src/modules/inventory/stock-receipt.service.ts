// Receiving stock at the store counter without a purchase order: the
// workbook's "IN" entry, with the supplier and the delivery/invoice number.
// Recorded as a goods receipt with no purchase order, posted at once, so it
// works whether or not procurement is switched on. All-or-nothing.
import { Prisma, InventoryTransactionType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { recomputeBalance } from '../../shared/inventory/balances.js';
import { dispatchDomainEvents, type DomainEvent } from '../../shared/events.js';
import { generateGRNumber } from '../procurement/goods-receipt.service.js';

type Decimal = Prisma.Decimal;

export interface ReceiveStockInput {
  supplierId: string;
  deliveryRef: string;
  /** Date on the delivery note; defaults to now. Cannot be in the future. */
  receivedAt?: string;
  lines: Array<{ materialId: string; locationId: string; quantity: number | string | Decimal }>;
  actorId: string;
}

export interface ReceiveStockResult {
  goodsReceiptId: string;
  number: string;
  transactionIds: string[];
}

function parseReceivedAt(value: string | undefined): Date {
  if (!value) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw Errors.validation('Invalid delivery date');
  // Allow today in any timezone, refuse anything later.
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw Errors.validation('The delivery date cannot be in the future');
  return d;
}

export const StockReceiptService = {
  async receive(input: ReceiveStockInput): Promise<ReceiveStockResult> {
    const deliveryRef = input.deliveryRef?.trim();
    if (!deliveryRef) throw Errors.validation('Enter the delivery note or invoice number');
    if (input.lines.length === 0) throw Errors.validation('Add at least one item to receive');
    const lines = input.lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, qty: toDecimal(l.quantity) }));
    if (lines.some((l) => !gtZero(l.qty))) throw Errors.validation('Received quantity must be positive');
    const receivedAt = parseReceivedAt(input.receivedAt);

    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw Errors.notFound('Supplier');
      if (!supplier.active) throw Errors.validation('Supplier is inactive');

      const checked = new Set<string>();
      for (const l of lines) {
        if (!checked.has(`m:${l.materialId}`)) {
          const m = await tx.material.findUnique({ where: { id: l.materialId } });
          if (!m) throw Errors.notFound('Material');
          if (!m.active) throw Errors.validation(`Material ${m.sku} is inactive`);
          checked.add(`m:${l.materialId}`);
        }
        if (!checked.has(`l:${l.locationId}`)) {
          const loc = await tx.location.findUnique({ where: { id: l.locationId } });
          if (!loc) throw Errors.notFound('Location');
          if (!loc.active) throw Errors.validation(`Location ${loc.name} is inactive`);
          checked.add(`l:${l.locationId}`);
        }
      }

      // Serialise receipt numbering, as GoodsReceiptService.create does.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:gr-number'))`;
      const number = await generateGRNumber(tx);
      const gr = await tx.goodsReceipt.create({
        data: {
          number,
          supplierId: supplier.id,
          deliveryRef,
          status: 'POSTED',
          receivedById: input.actorId,
          receivedAt,
          lines: { create: lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, quantity: l.qty })) },
        },
      });

      const transactionIds: string[] = [];
      for (const l of lines) {
        const trx = await tx.inventoryTransaction.create({
          data: {
            materialId: l.materialId,
            locationId: l.locationId,
            type: InventoryTransactionType.RECEIPT,
            quantity: l.qty,
            referenceType: 'GoodsReceipt',
            referenceId: gr.id,
            actorId: input.actorId,
          },
        });
        transactionIds.push(trx.id);
      }
      const touched = new Set(lines.map((l) => `${l.materialId}|${l.locationId}`));
      for (const key of touched) {
        const [materialId, locationId] = key.split('|') as [string, string];
        await recomputeBalance(materialId, locationId, tx);
      }

      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId,
          action: 'RECEIVE_STOCK',
          entityType: 'GoodsReceipt',
          entityId: gr.id,
          after: { number, supplierId: supplier.id, deliveryRef, lines: lines.length } as Prisma.InputJsonValue,
        },
      });

      const events: DomainEvent[] = [
        { type: 'GoodsReceived', goodsReceiptId: gr.id, purchaseOrderId: null },
        ...lines.map((l): DomainEvent => ({ type: 'InventoryIncreased', materialId: l.materialId, locationId: l.locationId, quantity: l.qty.toNumber() })),
      ];
      await dispatchDomainEvents(events);

      return { goodsReceiptId: gr.id, number, transactionIds };
    });
  },
};
