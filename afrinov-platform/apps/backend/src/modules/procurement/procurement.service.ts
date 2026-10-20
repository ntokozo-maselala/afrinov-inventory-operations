// Purchase order service — full lifecycle.
//
// State machine:
//   DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → RECEIVED → CLOSED
// - submit: DRAFT → PENDING_APPROVAL, or straight to APPROVED when approval
//   is turned off in settings.
// - Receiving (goods receipts, or receive() for everything outstanding) moves
//   APPROVED / PARTIALLY_RECEIVED on to PARTIALLY_RECEIVED or RECEIVED.
// - close: PARTIALLY_RECEIVED or RECEIVED → CLOSED. Closing short (lines not
//   fully received) needs a reason.
// - cancel: DRAFT / PENDING_APPROVAL / APPROVED → CANCELLED, before anything
//   is received.
// There is no shipping stage: local suppliers deliver with an invoice.
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
import { cleanPaymentTerms, cleanText, cleanVendorCode, cleanWebsite } from './supplier-fields.js';

export interface CreateSupplierInput {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  vendorCode?: string;
  address?: string;
  currency?: string;
  paymentTerms?: string;
  website?: string;
  services?: string;
}

/** Fields left out are unchanged; null clears an optional one. */
export interface UpdateSupplierInput {
  id: string;
  name?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  vendorCode?: string | null;
  address?: string | null;
  currency?: string;
  paymentTerms?: string | null;
  website?: string | null;
  services?: string | null;
  active?: boolean;
}

async function assertSupplierNameFree(name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw Errors.conflict(`Supplier "${clash.name}" already exists`);
}

async function assertVendorCodeFree(code: string, exceptId?: string): Promise<void> {
  const clash = await prisma.supplier.findFirst({
    where: { vendorCode: code, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw Errors.conflict(`Vendor code ${code} is already used by ${clash.name}`);
}

// Two requests saving the same name or vendor code at once: the unique index wins.
function rethrowSupplierClash(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw Errors.conflict('Another supplier already has this name or vendor code');
  }
  throw err;
}

export const SupplierService = {
  async list(q?: string) {
    return prisma.supplier.findMany({
      where: q
        ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { contactName: { contains: q, mode: 'insensitive' } },
            { vendorCode: { contains: q, mode: 'insensitive' } },
            { services: { contains: q, mode: 'insensitive' } },
          ],
        }
        : {},
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  },

  async getById(id: string) {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw Errors.notFound('Supplier');
    return supplier;
  },

  async create(input: CreateSupplierInput, actorId: string) {
    const name = cleanText(input.name);
    if (!name) throw Errors.validation('Name is required');
    await assertSupplierNameFree(name);
    const vendorCode = cleanVendorCode(input.vendorCode);
    if (vendorCode) await assertVendorCodeFree(vendorCode);

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.supplier.create({
          data: {
            name,
            contactName: cleanText(input.contactName),
            contactEmail: cleanText(input.contactEmail),
            contactPhone: cleanText(input.contactPhone),
            notes: cleanText(input.notes),
            vendorCode,
            address: cleanText(input.address),
            currency: input.currency ?? 'ZAR',
            paymentTerms: cleanPaymentTerms(input.paymentTerms),
            website: cleanWebsite(input.website),
            services: cleanText(input.services),
          },
        });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'CREATE',
            entityType: 'Supplier',
            entityId: created.id,
            after: created as unknown as Prisma.InputJsonValue,
          },
        });
        return created;
      });
    } catch (err) {
      rethrowSupplierClash(err);
    }
  },

  async update(input: UpdateSupplierInput, actorId: string) {
    const before = await prisma.supplier.findUnique({ where: { id: input.id } });
    if (!before) throw Errors.notFound('Supplier');
    const data: Prisma.SupplierUpdateInput = {};
    if (input.name !== undefined) {
      const name = cleanText(input.name);
      if (!name) throw Errors.validation('Name is required');
      await assertSupplierNameFree(name, input.id);
      data.name = name;
    }
    if (input.vendorCode !== undefined) {
      const code = cleanVendorCode(input.vendorCode);
      if (code) await assertVendorCodeFree(code, input.id);
      data.vendorCode = code;
    }
    if (input.contactName !== undefined) data.contactName = cleanText(input.contactName);
    if (input.contactEmail !== undefined) data.contactEmail = cleanText(input.contactEmail);
    if (input.contactPhone !== undefined) data.contactPhone = cleanText(input.contactPhone);
    if (input.notes !== undefined) data.notes = cleanText(input.notes);
    if (input.address !== undefined) data.address = cleanText(input.address);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.paymentTerms !== undefined) data.paymentTerms = cleanPaymentTerms(input.paymentTerms);
    if (input.website !== undefined) data.website = cleanWebsite(input.website);
    if (input.services !== undefined) data.services = cleanText(input.services);
    if (input.active !== undefined) data.active = input.active;

    try {
      return await prisma.$transaction(async (tx) => {
        const after = await tx.supplier.update({ where: { id: input.id }, data });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'UPDATE',
            entityType: 'Supplier',
            entityId: input.id,
            before: before as unknown as Prisma.InputJsonValue,
            after: after as unknown as Prisma.InputJsonValue,
          },
        });
        return after;
      });
    } catch (err) {
      rethrowSupplierClash(err);
    }
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

export interface ReceiveInput {
  id: string;
  locationId: string;
  deliveryNotes?: string;
}

export interface CloseInput {
  id: string;
  reason?: string;
}

/** Statuses a purchase order can be received against. */
export const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = ['APPROVED', 'PARTIALLY_RECEIVED'];

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
        deliveredBy: { select: { id: true, name: true, email: true } },
        cancelledBy: { select: { id: true, name: true, email: true } },
        closedBy: { select: { id: true, name: true, email: true } },
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
    if (!supplier.active) throw Errors.validation(`${supplier.name} is inactive. Reactivate the supplier to order from them.`);

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
      const allowed: PurchaseOrderStatus[] = ['DRAFT'];
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
      const allowed: PurchaseOrderStatus[] = ['PENDING_APPROVAL'];
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

  // Receive everything still outstanding: every line's shortfall becomes a
  // RECEIPT inventory transaction at the chosen location, and the order is
  // RECEIVED. Partial deliveries go through goods receipts instead. Calling
  // it twice is rejected by the status guard (ADR-002: the ledger stays the
  // source of truth).
  async receive(input: ReceiveInput, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: input.id },
        include: { lines: true },
      });
      if (!po) throw Errors.notFound('PurchaseOrder');
      if (!RECEIVABLE_STATUSES.includes(po.status)) {
        throw Errors.invalidState(`Only an approved or partly received purchase order can be received`, { status: po.status });
      }
      const location = await tx.location.findUnique({ where: { id: input.locationId } });
      if (!location) throw Errors.notFound('Location');
      if (!location.active) throw Errors.validation('Location is inactive');

      const now = new Date();
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: input.id, status: po.status },
        data: {
          status: 'RECEIVED',
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
          action: 'PO_RECEIVE',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { status: po.status },
          after: { status: 'RECEIVED', deliveredAt: now.toISOString(), deliveredById: actorId, locationId: input.locationId, notes: input.deliveryNotes ?? null },
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
      const allowed: PurchaseOrderStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
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

  // Close an order that will receive nothing more. Closing short — some lines
  // not fully received — needs a reason, so the shortfall is explained.
  async close(input: CloseInput, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: input.id }, include: { lines: true } });
      if (!po) throw Errors.notFound('PurchaseOrder');
      const allowed: PurchaseOrderStatus[] = ['PARTIALLY_RECEIVED', 'RECEIVED'];
      if (!allowed.includes(po.status)) {
        throw Errors.invalidState(`Purchase order in status ${po.status} cannot be closed`, { status: po.status });
      }
      const reason = input.reason?.trim() || null;
      const short = po.lines.some((l) => toDecimal(l.receivedQty).lt(toDecimal(l.orderedQty)));
      if (short && !reason) {
        throw Errors.validation('A reason is required to close an order that has not been fully received');
      }
      const now = new Date();
      const result = await tx.purchaseOrder.updateMany({
        where: { id: input.id, status: po.status },
        data: { status: 'CLOSED', closedAt: now, closedById: actorId, closeReason: reason },
      });
      if (result.count === 0) {
        throw Errors.conflict('This purchase order was updated by another user. Refresh the page to view the latest status.');
      }
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'PO_CLOSE',
          entityType: 'PurchaseOrder',
          entityId: input.id,
          before: { status: po.status },
          after: { status: 'CLOSED', closedAt: now.toISOString(), closedById: actorId, reason, closedShort: short },
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
    return status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'APPROVED';
  }
  return status === 'DRAFT' || status === 'PENDING_APPROVAL';
}

async function generatePONumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const count = await tx.purchaseOrder.count({
    where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
  });
  return `PO-${year}-${String(count + 1).padStart(4, '0')}`;
}