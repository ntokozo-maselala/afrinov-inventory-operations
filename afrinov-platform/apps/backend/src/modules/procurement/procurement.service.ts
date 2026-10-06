// Purchase order service — full lifecycle.
//
// State machine (canonical):
//   DRAFT → PENDING_APPROVAL → APPROVED → SHIPPED → DELIVERED
// with cancellation allowed from DRAFT / PENDING_APPROVAL / APPROVED.
// Legacy statuses (SUBMITTED, SENT, PARTIALLY_RECEIVED, FULLY_RECEIVED,
// CLOSED, REJECTED) are accepted on input and read on output for
// backward-compatibility, but new transitions route through the new enum
// members.
//
// Concurrency: every transition uses an optimistic WHERE status = expected
// guard inside the Prisma transaction. Two concurrent transitions on the
// same PO cannot both succeed.
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { SettingsService } from '../settings/settings.service.js';
import { toDecimal, gtZero } from '../../shared/decimal.js';
import { recomputeBalance } from '../../shared/inventory/balances.js';

export interface CreateSupplierInput {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
}

export const SupplierService = {
  async list(q?: string) {
    return prisma.supplier.findMany({
      where: q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { contactName: { contains: q, mode: 'insensitive' } }] }
        : {},
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  },

  async create(input: CreateSupplierInput, actorId: string) {
    const normalized = input.name.trim().toLowerCase();
    const existing = await prisma.supplier.findFirst({
      where: { name: { equals: normalized, mode: 'insensitive' } },
    });
    if (existing) throw Errors.conflict(`Supplier "${input.name}" already exists`);

    const created = await prisma.supplier.create({
      data: {
        name: input.name.trim(),
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        notes: input.notes ?? null,
      },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'CREATE',
        entityType: 'Supplier',
        entityId: created.id,
        after: created as unknown as Prisma.InputJsonValue,
      },
    });
    return created;
  },
};

export interface CreatePOInput {
  supplierId: string;
  lines: Array<{ materialId: string; orderedQty: number; unitPrice?: number }>;
  notes?: string;
  expectedDeliveryDate?: string;
}

export interface UpdatePOInput {
  id: string;
  notes?: string;
  expectedDeliveryDate?: string | null;
}

export interface ShipInput {
  id: string;
  trackingNumber?: string;
  carrier?: string;
  shipmentNotes?: string;
}

export interface DeliverInput {
  id: string;
  locationId: string;
  deliveryNotes?: string;
}

export interface CancelInput {
  id: string;
  reason: string;
}

function toDateOnly(iso: string): Date {
  // Accepts both YYYY-MM-DD and full ISO; truncates to start-of-day UTC.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw Errors.validation('Invalid expectedDeliveryDate');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const PurchaseOrderService = {
  async list(filter: { status?: PurchaseOrderStatus } = {}) {
    return prisma.purchaseOrder.findMany({
      where: filter,
      include: { supplier: true, lines: { include: { material: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(id: string) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        createdBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        shippedBy: { select: { id: true, name: true, email: true } },
        deliveredBy: { select: { id: true, name: true, email: true } },
        cancelledBy: { select: { id: true, name: true, email: true } },
        lines: { include: { material: true } },
        goodsReceipts: { include: { lines: true } },
      },
    });
    if (!po) throw Errors.notFound('PurchaseOrder');
    return po;
  },

  async create(input: CreatePOInput, actorId: string) {
    if (input.lines.length === 0) throw Errors.validation('Purchase order must have at least one line');
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw Errors.notFound('Supplier');

    return prisma.$transaction(async (tx) => {
      // Serialize PO-number generation so two concurrent creates cannot
      // collide on the same sequential number. The advisory lock is scoped
      // to this transaction and auto-released on commit/rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afrinov:po-number'))`;
      const number = await generatePONumber(tx);
      return tx.purchaseOrder.create({
        data: {
          number,
          supplierId: input.supplierId,
          notes: input.notes ?? null,
          expectedDeliveryDate: input.expectedDeliveryDate ? toDateOnly(input.expectedDeliveryDate) : null,
          createdById: actorId,
          status: 'DRAFT',
          lines: {
            create: input.lines.map((l) => ({
              materialId: l.materialId,
              orderedQty: l.orderedQty,
              receivedQty: 0,
            })),
          },
        },
        include: { lines: true, supplier: true },
      });
    });
  },

  async update(input: UpdatePOInput, actorId: string) {
    const allowEditAfterApproval = await SettingsService.getValue<boolean>('purchaseOrders.allowEditAfterApproval');
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: input.id } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      if (!isEditable(po.status, allowEditAfterApproval)) {
        throw Errors.invalidState(`Purchase order in status ${po.status} is no longer editable`, { status: po.status });
      }
      const data: Prisma.PurchaseOrderUpdateInput = {};
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.expectedDeliveryDate !== undefined) {
        data.expectedDeliveryDate = input.expectedDeliveryDate === null
          ? null
          : toDateOnly(input.expectedDeliveryDate);
      }
      const after = await tx.purchaseOrder.update({ where: { id: input.id }, data });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'UPDATE',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { notes: po.notes, expectedDeliveryDate: po.expectedDeliveryDate },
          after: { notes: after.notes, expectedDeliveryDate: after.expectedDeliveryDate },
        },
      });
      return after;
    });
  },

  async submit(id: string, actorId: string) {
    const requireApproval = await SettingsService.getValue<boolean>('purchaseOrders.requireApprovalBeforeProcessing');
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      if (po.lines.length === 0) throw Errors.validation('Cannot submit an empty purchase order');
      const allowed: PurchaseOrderStatus[] = ['DRAFT', 'SUBMITTED'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Cannot submit a PO in status ${po.status}`, { status: po.status });
      }
      const now = new Date();
      if (requireApproval) {
        const target: PurchaseOrderStatus = 'PENDING_APPROVAL';
        const result = await tx.purchaseOrder.updateMany({
          where: { id, status: { in: allowed } },
          data: { status: target },
        });
        if (result.count === 0) {
          throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
        }
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'PO_SUBMIT',
            entityType: 'PurchaseOrder',
            entityId: id,
            before: { status: po.status },
            after: { status: target },
          },
        });
      } else {
        // Approval not required: submission auto-approves.
        const result = await tx.purchaseOrder.updateMany({
          where: { id, status: { in: allowed } },
          data: { status: 'APPROVED', approvedAt: now, approvedById: actorId },
        });
        if (result.count === 0) {
          throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
        }
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'PO_SUBMIT_AUTO_APPROVE',
            entityType: 'PurchaseOrder',
            entityId: id,
            before: { status: po.status },
            after: { status: 'APPROVED', approvedAt: now.toISOString(), approvedById: actorId, autoApprove: true },
          },
        });
      }
      return tx.purchaseOrder.findUnique({ where: { id } });
    });
  },

  async approve(id: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      const allowed: PurchaseOrderStatus[] = ['PENDING_APPROVAL', 'SUBMITTED'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Cannot approve a PO in status ${po.status}`, { status: po.status });
      }
      const now = new Date();
      const result = await tx.purchaseOrder.updateMany({
        where: { id, status: { in: allowed } },
        data: { status: 'APPROVED', approvedAt: now, approvedById: actorId },
      });
      if (result.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_APPROVE',
          entityType: 'PurchaseOrder',
          entityId: id,
          before: { status: po.status },
          after: { status: 'APPROVED', approvedAt: now.toISOString(), approvedById: actorId },
        },
      });
      return tx.purchaseOrder.findUnique({ where: { id } });
    });
  },

  async ship(input: ShipInput, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: input.id } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      if (po.status !== 'APPROVED') {
        throw Errors.invalidState(`Only an APPROVED purchase order can be marked as shipped`, { status: po.status });
      }
      const now = new Date();
      const result = await tx.purchaseOrder.updateMany({
        where: { id: input.id, status: 'APPROVED' },
        data: {
          status: 'SHIPPED',
          shippedAt: now,
          shippedById: actorId,
          trackingNumber: input.trackingNumber ?? null,
          carrier: input.carrier ?? null,
          shipmentNotes: input.shipmentNotes ?? null,
        },
      });
      if (result.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_SHIP',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { status: 'APPROVED' },
          after: { status: 'SHIPPED', shippedAt: now.toISOString(), shippedById: actorId, trackingNumber: input.trackingNumber ?? null, carrier: input.carrier ?? null },
        },
      });
      return tx.purchaseOrder.findUnique({ where: { id: input.id } });
    });
  },

  // Deliver the entire PO: every ordered line becomes a RECEIPT inventory
  // transaction at the chosen location. The action is idempotent — calling
  // it twice on the same PO is rejected by the status guard. Reuses the
  // existing inventory posting logic to keep the ledger the source of
  // truth (ADR-002).
  async deliver(input: DeliverInput, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: input.id },
        include: { lines: true },
      });
      if (!po) throw Errors.notFound('PurchaseOrder');
      if (po.status !== 'SHIPPED') {
        throw Errors.invalidState(`Only a SHIPPED purchase order can be marked as delivered`, { status: po.status });
      }
      const location = await tx.location.findUnique({ where: { id: input.locationId } });
      if (!location) throw Errors.notFound('Location');
      if (!location.active) throw Errors.validation('Location is inactive');

      const now = new Date();
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: input.id, status: 'SHIPPED' },
        data: {
          status: 'DELIVERED',
          deliveredAt: now,
          deliveredById: actorId,
          deliveryNotes: input.deliveryNotes ?? null,
        },
      });
      if (claimed.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }

      for (const line of po.lines) {
        const orderedQty = toDecimal(line.orderedQty);
        const alreadyReceived = toDecimal(line.receivedQty);
        // Only create receipt transactions for the shortfall so that partial
        // receipts (e.g. via GoodsReceipt posting) are not double-counted.
        const toReceive = orderedQty.minus(alreadyReceived);
        if (gtZero(toReceive)) {
          await tx.inventoryTransaction.create({
            data: {
              materialId: line.materialId,
              locationId: input.locationId,
              type: 'RECEIPT',
              quantity: toReceive,
              referenceType: 'PurchaseOrder',
              referenceId: po.id,
              actorId,
            },
          });
          await recomputeBalance(line.materialId, input.locationId, tx);
        }

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQty: orderedQty },
        });
      }

      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_DELIVER',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { status: 'SHIPPED' },
          after: { status: 'DELIVERED', deliveredAt: now.toISOString(), deliveredById: actorId, locationId: input.locationId, notes: input.deliveryNotes ?? null },
        },
      });
      return tx.purchaseOrder.findUnique({ where: { id: input.id } });
    });
  },

  async cancel(input: CancelInput, actorId: string) {
    const allowCancellation = await SettingsService.getValue<boolean>('purchaseOrders.allowCancellation');
    if (!allowCancellation) {
      throw Errors.forbidden('Cancelling purchase orders is disabled in system settings');
    }
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: input.id } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      const allowed: PurchaseOrderStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED', 'APPROVED'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Purchase order in status ${po.status} cannot be cancelled`, { status: po.status });
      }
      const reason = input.reason?.trim();
      if (!reason) throw Errors.validation('A cancellation reason is required');
      const now = new Date();
      const result = await tx.purchaseOrder.updateMany({
        where: { id: input.id, status: { in: allowed } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledById: actorId, cancellationReason: reason },
      });
      if (result.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_CANCEL',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { status: po.status },
          after: { status: 'CANCELLED', cancelledAt: now.toISOString(), cancelledById: actorId, reason },
        },
      });
      return tx.purchaseOrder.findUnique({ where: { id: input.id } });
    });
  },

  // Returns the audit log entries relevant to a PO so the UI can render
  // an activity feed. Ordered most-recent first.
  async history(id: string) {
    return prisma.auditLogEntry.findMany({
      where: { entityType: 'PurchaseOrder', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },
};

function isEditable(status: PurchaseOrderStatus, allowEditAfterApproval = true): boolean {
  if (allowEditAfterApproval) {
    return status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'SUBMITTED' || status === 'APPROVED';
  }
  return status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'SUBMITTED';
}

async function generatePONumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const count = await tx.purchaseOrder.count({
    where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
  });
  return `PO-${year}-${String(count + 1).padStart(4, '0')}`;
}