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

export interface IssueLine {
  materialId: string;
  locationId: string;
  quantity: number | string | Decimal;
}

// One entry at the store counter: one recipient, optionally one project, and
// any number of items. Booked all-or-nothing.
export interface IssueInput {
  recipientId: string;
  projectNumber?: string;
  lines: IssueLine[];
  actorId: string;
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

export interface ReturnInput {
  issueTransactionId: string;
  quantity: number | string | Decimal;
  /** Where the stock goes back to; defaults to the location it was issued from. */
  locationId?: string;
  reason?: string;
  actorId: string;
}

export interface GoodsReceiptPostInput {
  goodsReceiptId: string;
  actorId: string;
}

async function checkMaterialActive(materialId: string, tx: Prisma.TransactionClient) {
  const m = await tx.material.findUnique({ where: { id: materialId } });
  if (!m) throw Errors.notFound('Material');
  if (!m.active) throw Errors.validation('Material is inactive');
  return m;
}

async function checkProjectActive(projectNumber: string, tx: Prisma.TransactionClient): Promise<void> {
  const p = await tx.project.findUnique({ where: { projectNumber } });
  if (!p) throw Errors.notFound('Project');
  if (!p.active) throw Errors.validation('Project is inactive');
}

async function returnedAgainst(issueId: string, tx: Prisma.TransactionClient): Promise<Decimal> {
  const agg = await tx.inventoryTransaction.aggregate({
    where: { type: InventoryTransactionType.RETURN, referenceType: 'Return', referenceId: issueId },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? toDecimal(0);
}

async function checkRecipientActive(recipientId: string, tx: Prisma.TransactionClient): Promise<void> {
  const r = await tx.recipient.findUnique({ where: { id: recipientId } });
  if (!r) throw Errors.notFound('Recipient');
  if (!r.active) throw Errors.validation('Recipient is inactive');
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
        recipient: { select: { name: true, type: true } },
      },
      orderBy: { postedAt: 'desc' },
      take,
    });
    // Receipts point at their goods receipt; show its number, supplier and
    // delivery/invoice number alongside the movement.
    const receiptIds = [...new Set(rows.filter((t) => t.referenceType === 'GoodsReceipt' && t.referenceId).map((t) => t.referenceId!))];
    const receipts = receiptIds.length === 0 ? [] : await prisma.goodsReceipt.findMany({
      where: { id: { in: receiptIds } },
      select: { id: true, number: true, deliveryRef: true, supplier: { select: { name: true } } },
    });
    const receiptById = new Map(receipts.map((r) => [r.id, r]));
    const issueIds = rows.filter((t) => t.type === InventoryTransactionType.ISSUE).map((t) => t.id);
    const returnedRows = issueIds.length === 0 ? [] : await prisma.inventoryTransaction.groupBy({
      by: ['referenceId'],
      where: { type: InventoryTransactionType.RETURN, referenceType: 'Return', referenceId: { in: issueIds } },
      _sum: { quantity: true },
    });
    const returnedByIssue = new Map(returnedRows.map((r) => [r.referenceId, r._sum.quantity]));
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
      recipientName: t.recipient?.name ?? null,
      recipientType: t.recipient?.type ?? null,
      reasonCode: t.reasonCode,
      reasonNote: t.reasonNote,
      projectNumber: t.projectNumber,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
      reversesId: t.reversesId,
      reversedById: t.reversedBy?.id ?? null,
      returnedQuantity: t.type === InventoryTransactionType.ISSUE ? (returnedByIssue.get(t.id)?.toString() ?? '0') : null,
      ...(() => {
        const r = t.referenceId ? receiptById.get(t.referenceId) : undefined;
        return { receiptNumber: r?.number ?? null, supplierName: r?.supplier.name ?? null, deliveryRef: r?.deliveryRef ?? null };
      })(),
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
        // Receipts against a purchase order also moved the order's received
        // quantities, so they cannot be reversed here. Counter receipts
        // (no purchase order) can.
        if (original.referenceType === 'GoodsReceipt' && original.referenceId) {
          const gr = await tx.goodsReceipt.findUnique({ where: { id: original.referenceId } });
          if (gr?.purchaseOrderId) {
            throw Errors.invalidState('Stock received against a purchase order cannot be reversed here.');
          }
        }

        if (original.type === InventoryTransactionType.ISSUE && gtZero(await returnedAgainst(original.id, tx))) {
          throw Errors.invalidState('Part of this issue has been returned. Reverse the returns first.');
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

  async issue(input: IssueInput): Promise<{ transactionIds: string[] }> {
    if (!input.recipientId) throw Errors.validation('Choose who the stock is issued to');
    if (input.lines.length === 0) throw Errors.validation('Add at least one item to issue');
    const lines = input.lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId, qty: toDecimal(l.quantity) }));
    if (lines.some((l) => !gtZero(l.qty))) throw Errors.validation('Issue quantity must be positive');

    // The same item from the same location on two lines is checked as one total.
    const totals = new Map<string, { materialId: string; locationId: string; qty: Decimal }>();
    for (const l of lines) {
      const key = `${l.materialId}|${l.locationId}`;
      const t = totals.get(key);
      if (t) t.qty = t.qty.plus(l.qty);
      else totals.set(key, { materialId: l.materialId, locationId: l.locationId, qty: l.qty });
    }

    return prisma.$transaction(async (tx) => {
      await checkRecipientActive(input.recipientId, tx);
      if (input.projectNumber) await checkProjectActive(input.projectNumber, tx);

      const materials = new Map<string, Awaited<ReturnType<typeof checkMaterialActive>>>();
      for (const t of totals.values()) {
        const material = await checkMaterialActive(t.materialId, tx);
        materials.set(t.materialId, material);
        await checkLocationActive(t.locationId, tx);

        // Stock can never go below zero. This is a fixed rule, not a setting:
        // a negative balance means the ledger no longer matches the shelf.
        const balance = await getCurrentBalance(t.materialId, t.locationId, tx);
        if (balance.lt(t.qty)) {
          throw Errors.insufficientBalance(
            `Cannot issue ${t.qty.toString()} × ${material.sku}: only ${balance.toString()} available.`,
            { materialId: t.materialId, locationId: t.locationId, requested: t.qty.toString(), available: balance.toString() },
          );
        }
      }

      const transactionIds: string[] = [];
      for (const l of lines) {
        const trx = await tx.inventoryTransaction.create({
          data: {
            materialId: l.materialId,
            locationId: l.locationId,
            type: InventoryTransactionType.ISSUE,
            quantity: l.qty.negated(),
            actorId: input.actorId,
            recipientId: input.recipientId,
            projectNumber: input.projectNumber ?? null,
            referenceType: input.projectNumber ? 'Project' : null,
            referenceId: input.projectNumber ?? null,
          },
        });
        transactionIds.push(trx.id);
      }

      const events: DomainEvent[] = lines.map((l) => ({
        type: 'InventoryIssued', materialId: l.materialId, locationId: l.locationId, quantity: l.qty.toNumber(),
      }));
      const alertsOn = await SettingsService.getValue<boolean>('inventory.enableStockAlerts', tx);
      for (const t of totals.values()) {
        await recomputeBalance(t.materialId, t.locationId, tx);
        const material = materials.get(t.materialId);
        const updatedBalance = await getCurrentBalance(t.materialId, t.locationId, tx);
        if (alertsOn && material && updatedBalance.lte(material.requiredStock)) {
          events.push({ type: 'StockThresholdReached', materialId: t.materialId });
        }
      }

      await dispatchDomainEvents(events);
      return { transactionIds };
    });
  },

  /**
   * Return unused stock from an issue. Recorded as a RETURN that points at the
   * issue and keeps its recipient and project, so project consumption nets the
   * return out. At most the issued quantity, less what has already come back.
   */
  async returnToStock(input: ReturnInput): Promise<{ transactionId: string; returnedQuantity: string; returnableQuantity: string }> {
    const qty = toDecimal(input.quantity);
    if (!gtZero(qty)) throw Errors.validation('Return quantity must be positive');

    return prisma.$transaction(async (tx) => {
      const issue = await tx.inventoryTransaction.findUnique({
        where: { id: input.issueTransactionId },
        include: { reversedBy: { select: { id: true } } },
      });
      if (!issue) throw Errors.notFound('InventoryTransaction');
      if (issue.type !== InventoryTransactionType.ISSUE || issue.reversesId) {
        throw Errors.invalidState('Only an issue can have stock returned against it.');
      }
      if (issue.reversedBy) throw Errors.invalidState('This issue has been reversed, so there is nothing to return.');

      const issued = issue.quantity.negated();
      const alreadyReturned = await returnedAgainst(issue.id, tx);
      const returnable = issued.minus(alreadyReturned);
      if (qty.gt(returnable)) {
        throw Errors.validation(
          `Cannot return ${qty.toString()}: only ${returnable.toString()} of the ${issued.toString()} issued is still out.`,
          { issued: issued.toString(), returned: alreadyReturned.toString(), returnable: returnable.toString() },
        );
      }

      const locationId = input.locationId ?? issue.locationId;
      await checkLocationActive(locationId, tx);

      const trx = await tx.inventoryTransaction.create({
        data: {
          materialId: issue.materialId,
          locationId,
          type: InventoryTransactionType.RETURN,
          quantity: qty,
          actorId: input.actorId,
          recipientId: issue.recipientId,
          projectNumber: issue.projectNumber,
          reasonNote: input.reason?.trim() || null,
          referenceType: 'Return',
          referenceId: issue.id,
        },
      });
      await recomputeBalance(issue.materialId, locationId, tx);

      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId,
          action: 'RETURN',
          entityType: 'InventoryTransaction',
          entityId: issue.id,
          after: { returnTransactionId: trx.id, quantity: qty.toString(), locationId } as Prisma.InputJsonValue,
        },
      });

      await dispatchDomainEvents([
        { type: 'InventoryIncreased', materialId: issue.materialId, locationId, quantity: qty.toNumber() },
      ]);

      const returned = alreadyReturned.plus(qty);
      return { transactionId: trx.id, returnedQuantity: returned.toString(), returnableQuantity: issued.minus(returned).toString() };
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