// InventoryService — the only place allowed to write to inventory_transactions
// and (indirectly via balance recompute) inventory_balances.
//
// All public methods run inside a transaction. ADR-002: balances are derived
// from transactions; we never mutate balances directly. After any transaction
// is committed we synchronously recompute the affected (material, location)
// balance row(s) to keep the read model in sync.
import { Prisma, InventoryTransactionType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { dispatchDomainEvents, type DomainEvent } from '../../shared/events.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { recomputeBalance, getCurrentBalance } from '../../shared/inventory/balances.js';
import { SettingsService } from '../settings/settings.service.js';

type Decimal = Prisma.Decimal;

export interface IssueInput {
  materialId: string;
  locationId: string;
  quantity: number | string | Decimal;
  actorId: string;
  recipientId?: string;
  projectNumber?: string;
}

export interface TransferInput {
  materialId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number | string | Decimal;
  actorId: string;
}

export interface AdjustmentInput {
  materialId: string;
  locationId: string;
  quantity: number | string | Decimal;
  reasonCode: 'COUNT_VARIANCE' | 'DAMAGE' | 'LOSS' | 'SCRAP' | 'OTHER';
  reasonNote?: string;
  actorId: string;
}

export interface GoodsReceiptPostInput {
  goodsReceiptId: string;
  actorId: string;
}

async function checkMaterialActive(materialId: string, tx: Prisma.TransactionClient): Promise<void> {
  const m = await tx.material.findUnique({ where: { id: materialId } });
  if (!m) throw Errors.notFound('Material');
  if (!m.active) throw Errors.validation('Material is inactive');
}

async function checkLocationActive(locationId: string, tx: Prisma.TransactionClient): Promise<void> {
  const l = await tx.location.findUnique({ where: { id: locationId } });
  if (!l) throw Errors.notFound('Location');
  if (!l.active) throw Errors.validation('Location is inactive');
}

export interface ReverseInput {
  transactionId: string;
  reason: string;
  actorId: string;
}

export const InventoryService = {
   async queryHistory(filter: { materialId?: string; type?: string; from?: string; to?: string; projectNumber?: string; limit?: number }) {
    const where: Prisma.InventoryTransactionWhereInput = {};
    if (filter.materialId) where.materialId = filter.materialId;
    if (filter.type) where.type = filter.type as Prisma.InventoryTransactionWhereInput['type'];
    if (filter.projectNumber) where.projectNumber = filter.projectNumber;
    if (filter.from || filter.to) {
      where.postedAt = {};
      if (filter.from) where.postedAt.gte = new Date(filter.from);
      if (filter.to) where.postedAt.lte = new Date(filter.to);
    }
    // Cap the page size to prevent unbounded memory usage from a single request.
    const take = Math.min(filter.limit ?? 200, 1000);
    const rows = await prisma.inventoryTransaction.findMany({
      where,
      include: {
        material: true,
        location: true,
        actor: { select: { id: true, name: true, email: true } },
        reversedBy: { select: { id: true } },
      },
      orderBy: { postedAt: 'desc' },
      take,
    });
    return rows.map((t) => ({
      id: t.id,
      postedAt: t.postedAt.toISOString(),
      type: t.type,
      materialId: t.materialId,
      materialSku: t.material.sku,
      materialName: t.material.name,
      locationId: t.locationId,
      locationName: t.location.name,
      quantity: t.quantity.toString(),
      actorId: t.actorId,
      actorName: t.actor.name,
      recipientId: t.recipientId,
      reasonCode: t.reasonCode,
      reasonNote: t.reasonNote,
      projectNumber: t.projectNumber,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
      reversesId: t.reversesId,
      reversedById: t.reversedBy?.id ?? null,
    }));
  },
  /**
   * Reverse a movement by posting an opposite entry that points at it. The
   * ledger has no update path, so this is the only way to correct a mistake.
   * A reversal keeps the original's type with the opposite sign, so balances
   * and signed totals net to zero. Both legs of a transfer are reversed
   * together. A transaction can be reversed at most once (unique reverses_id).
   */
  async reverse(input: ReverseInput): Promise<{ reversalIds: string[] }> {
    const reason = input.reason.trim();
    if (!reason) throw Errors.validation('A reason is required to reverse a movement');

    try {
      return await prisma.$transaction(async (tx) => {
        const original = await tx.inventoryTransaction.findUnique({
          where: { id: input.transactionId },
          include: { reversedBy: { select: { id: true } } },
        });
        if (!original) throw Errors.notFound('InventoryTransaction');
        if (original.reversesId) {
          throw Errors.invalidState('A reversal cannot itself be reversed. Record the movement again instead.');
        }
        if (original.referenceType === 'GoodsReceipt') {
          throw Errors.invalidState('Stock received against a goods receipt cannot be reversed here.');
        }

        const legs = [original];
        if (original.pairedWithId) {
          const partner = await tx.inventoryTransaction.findUnique({
            where: { id: original.pairedWithId },
            include: { reversedBy: { select: { id: true } } },
          });
          if (!partner) throw Errors.notFound('InventoryTransaction');
          // Keep the outgoing leg first so the reversal legs pair the same way.
          if (partner.type === InventoryTransactionType.TRANSFER_OUT) legs.unshift(partner);
          else legs.push(partner);
        }
        if (legs.some((leg) => leg.reversedBy)) {
          throw Errors.conflict('This movement has already been reversed.');
        }

        // A reversal must not take any balance below zero.
        for (const leg of legs) {
          if (!leg.quantity.isPositive()) continue;
          const balance = await getCurrentBalance(leg.materialId, leg.locationId, tx);
          if (balance.lt(leg.quantity)) {
            throw Errors.insufficientBalance(
              `Cannot reverse: only ${balance.toString()} of the ${leg.quantity.toString()} units are still in stock.`,
              { materialId: leg.materialId, locationId: leg.locationId, requested: leg.quantity.toString(), available: balance.toString() },
            );
          }
        }

        const reversals = [];
        for (const leg of legs) {
          reversals.push(
            await tx.inventoryTransaction.create({
              data: {
                materialId: leg.materialId,
                locationId: leg.locationId,
                type: leg.type,
                quantity: leg.quantity.negated(),
                actorId: input.actorId,
                recipientId: leg.recipientId,
                projectNumber: leg.projectNumber,
                reasonCode: leg.reasonCode,
                reasonNote: reason,
                referenceType: leg.referenceType,
                referenceId: leg.referenceId,
                reversesId: leg.id,
              },
            }),
          );
        }
        // Tie the two reversal legs of a transfer together, as transfer() does.
        if (reversals.length === 2) {
          const [out, inn] = reversals as [typeof reversals[number], typeof reversals[number]];
          await tx.inventoryTransaction.update({ where: { id: inn.id }, data: { pairedWithId: out.id } });
          await tx.inventoryTransaction.update({ where: { id: out.id }, data: { pairedWithId: inn.id } });
        }

        for (const leg of legs) {
          await recomputeBalance(leg.materialId, leg.locationId, tx);
        }

        const reversalIds = reversals.map((r) => r.id);
        await tx.auditLogEntry.create({
          data: {
            actorId: input.actorId,
            action: 'REVERSE',
            entityType: 'InventoryTransaction',
            entityId: original.id,
            after: { reversalIds, reason } as Prisma.InputJsonValue,
          },
        });

        return { reversalIds };
      });
    } catch (err) {
      // Two requests reversing the same movement at once: the unique index wins.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('This movement has already been reversed.');
      }
      throw err;
    }
  },

  async issue(input: IssueInput): Promise<{ transactionId: string }> {
    const qty = toDecimal(input.quantity);
    if (!gtZero(qty)) throw Errors.validation('Issue quantity must be positive');

    return prisma.$transaction(async (tx) => {
      await checkMaterialActive(input.materialId, tx);
      await checkLocationActive(input.locationId, tx);

      // Stock can never go below zero. This is a fixed rule, not a setting:
      // a negative balance means the ledger no longer matches the shelf.
      const balance = await getCurrentBalance(input.materialId, input.locationId, tx);
      if (balance.lt(qty)) {
        throw Errors.insufficientBalance(
          `Cannot issue ${qty.toString()} units: only ${balance.toString()} available.`,
          { materialId: input.materialId, locationId: input.locationId, requested: qty.toString(), available: balance.toString() },
        );
      }

      const trx = await tx.inventoryTransaction.create({
        data: {
          materialId: input.materialId,
          locationId: input.locationId,
          type: InventoryTransactionType.ISSUE,
          quantity: qty.negated(),
          actorId: input.actorId,
          recipientId: input.recipientId ?? null,
          projectNumber: input.projectNumber ?? null,
          referenceType: input.projectNumber ? 'Project' : null,
          referenceId: input.projectNumber ?? null,
        },
      });

      await recomputeBalance(input.materialId, input.locationId, tx);

      const material = await tx.material.findUnique({ where: { id: input.materialId } });
      const updatedBalance = await getCurrentBalance(input.materialId, input.locationId, tx);

      const events: DomainEvent[] = [
        { type: 'InventoryIssued', materialId: input.materialId, locationId: input.locationId, quantity: qty.toNumber() },
      ];
      const alertsOn = await SettingsService.getValue<boolean>('inventory.enableStockAlerts', tx);
      if (alertsOn && material && updatedBalance.lte(material.requiredStock)) {
        events.push({ type: 'StockThresholdReached', materialId: input.materialId });
      }

      await dispatchDomainEvents(events);
      return { transactionId: trx.id };
    });
  },

  async transfer(input: TransferInput): Promise<{ outTransactionId: string; inTransactionId: string }> {
    const qty = toDecimal(input.quantity);
    if (!gtZero(qty)) throw Errors.validation('Transfer quantity must be positive');
    if (input.fromLocationId === input.toLocationId) {
      throw Errors.validation('Source and destination locations must differ');
    }

    return prisma.$transaction(async (tx) => {
      await checkMaterialActive(input.materialId, tx);
      await checkLocationActive(input.fromLocationId, tx);
      await checkLocationActive(input.toLocationId, tx);

      const balance = await getCurrentBalance(input.materialId, input.fromLocationId, tx);
      if (balance.lt(qty)) {
        throw Errors.insufficientBalance(
          `Cannot transfer ${qty.toString()} units: only ${balance.toString()} available at source.`,
          { materialId: input.materialId, fromLocationId: input.fromLocationId, requested: qty.toString(), available: balance.toString() },
        );
      }

      const out = await tx.inventoryTransaction.create({
        data: {
          materialId: input.materialId,
          locationId: input.fromLocationId,
          type: InventoryTransactionType.TRANSFER_OUT,
          quantity: qty.negated(),
          actorId: input.actorId,
        },
      });

      const inn = await tx.inventoryTransaction.create({
        data: {
          materialId: input.materialId,
          locationId: input.toLocationId,
          type: InventoryTransactionType.TRANSFER_IN,
          quantity: qty,
          actorId: input.actorId,
          pairedWithId: out.id,
        },
      });

      await tx.inventoryTransaction.update({
        where: { id: out.id },
        data: { pairedWithId: inn.id },
      });

      await recomputeBalance(input.materialId, input.fromLocationId, tx);
      await recomputeBalance(input.materialId, input.toLocationId, tx);

      await dispatchDomainEvents([
        {
          type: 'InventoryTransferred',
          materialId: input.materialId,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          quantity: qty.toNumber(),
        },
      ]);

      return { outTransactionId: out.id, inTransactionId: inn.id };
    });
  },

  async adjust(input: AdjustmentInput): Promise<{ transactionId: string }> {
    const qty = toDecimal(input.quantity);
    if (qty.isZero()) throw Errors.validation('Adjustment quantity must be non-zero');

    return prisma.$transaction(async (tx) => {
      await checkMaterialActive(input.materialId, tx);
      await checkLocationActive(input.locationId, tx);

      // See issue(): stock can never go below zero.
      if (qty.isNegative()) {
        const balance = await getCurrentBalance(input.materialId, input.locationId, tx);
        if (balance.lt(qty.negated())) {
          throw Errors.insufficientBalance(
            `Cannot adjust ${qty.toString()} units: only ${balance.toString()} available.`,
            { materialId: input.materialId, locationId: input.locationId, requested: qty.toString(), available: balance.toString() },
          );
        }
      }

      const trx = await tx.inventoryTransaction.create({
        data: {
          materialId: input.materialId,
          locationId: input.locationId,
          type: InventoryTransactionType.ADJUSTMENT,
          quantity: qty,
          reasonCode: input.reasonCode,
          reasonNote: input.reasonNote ?? null,
          actorId: input.actorId,
        },
      });

      await recomputeBalance(input.materialId, input.locationId, tx);

      await dispatchDomainEvents([
        { type: 'InventoryAdjusted', materialId: input.materialId, locationId: input.locationId, quantity: qty.toNumber() },
      ]);

      return { transactionId: trx.id };
    });
  },

  /**
   * Post a GoodsReceipt: creates Receipt transactions for each line and updates
   * the linked PO's received quantities. Must be atomic.
   */
  async postGoodsReceipt(input: GoodsReceiptPostInput): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const gr = await tx.goodsReceipt.findUnique({
        where: { id: input.goodsReceiptId },
        include: { lines: true },
      });
      if (!gr) throw Errors.notFound('GoodsReceipt');
      if (gr.status === 'POSTED') throw Errors.invalidState('Goods receipt already posted');
      if (gr.status === 'DRAFT') throw Errors.invalidState('Goods receipt must be SUBMITTED before posting');
      // The order may have been cancelled or closed since the receipt was recorded.
      if (gr.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: gr.purchaseOrderId } });
        if (po && po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
          throw Errors.invalidState(`Cannot receive against a purchase order in status ${po.status}`, { status: po.status });
        }
      }

      for (const line of gr.lines) {
        const qty = toDecimal(line.quantity);
        await tx.inventoryTransaction.create({
          data: {
            materialId: line.materialId,
            locationId: line.locationId,
            type: InventoryTransactionType.RECEIPT,
            quantity: qty,
            referenceType: 'GoodsReceipt',
            referenceId: gr.id,
            actorId: input.actorId,
          },
        });

        if (line.purchaseOrderLineId) {
          // Prevent receiving more than the ordered quantity on a PO line.
          const poLine = await tx.purchaseOrderLine.findUnique({
            where: { id: line.purchaseOrderLineId },
          });
          if (poLine) {
            const orderedQty = toDecimal(poLine.orderedQty);
            const alreadyReceived = toDecimal(poLine.receivedQty);
            const projected = alreadyReceived.plus(qty);
            if (projected.gt(orderedQty)) {
              throw Errors.validation(
                `Receiving ${qty.toString()} would exceed the ordered quantity of ${orderedQty.toString()} for this line.`,
                { orderedQty: orderedQty.toString(), alreadyReceived: alreadyReceived.toString(), receiving: qty.toString() },
              );
            }
            await tx.purchaseOrderLine.update({
              where: { id: line.purchaseOrderLineId },
              data: { receivedQty: { increment: qty } },
            });
          }
        }

        await recomputeBalance(line.materialId, line.locationId, tx);
      }

      await tx.goodsReceipt.update({
        where: { id: gr.id },
        data: { status: 'POSTED' },
      });

      // Update PO status based on lines.
      if (gr.purchaseOrderId) {
        const lines = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId: gr.purchaseOrderId },
        });
        const allFully = lines.every((l) => toDecimal(l.receivedQty).gte(toDecimal(l.orderedQty)));
        const anyReceived = lines.some((l) => gtZero(toDecimal(l.receivedQty)));
        if (allFully || anyReceived) {
          await tx.purchaseOrder.update({
            where: { id: gr.purchaseOrderId },
            data: allFully
              ? { status: 'RECEIVED', deliveredAt: new Date(), deliveredById: input.actorId }
              : { status: 'PARTIALLY_RECEIVED' },
          });
        }
      }

      await dispatchDomainEvents([
        { type: 'GoodsReceived', goodsReceiptId: gr.id, purchaseOrderId: gr.purchaseOrderId },
      ]);
    });
  },
};