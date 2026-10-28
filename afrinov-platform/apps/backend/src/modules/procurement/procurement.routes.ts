import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supplierIdSchema } from '../../shared/ids.js';
import { DELIVERY_METHODS, PurchaseOrderService, SupplierService } from './procurement.service.js';
import { GoodsReceiptService } from './goods-receipt.service.js';
import { EMAIL_PATTERN, SUPPLIER_CURRENCIES } from './supplier-fields.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import { prisma } from '../../shared/db.js';

const supplierCurrency = z.enum(SUPPLIER_CURRENCIES);
const vendorCode = z.string().trim().max(20).regex(/^[A-Za-z0-9-]*$/, 'Letters, digits and dashes only');

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  vendorCode: vendorCode.optional(),
  address: z.string().max(500).optional(),
  currency: supplierCurrency.optional(),
  paymentTerms: z.string().max(100).optional(),
  website: z.string().max(200).optional(),
  services: z.string().max(500).optional(),
});

// Fields left out are unchanged; null (or an empty string) clears an optional one.
export const updateSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.union([z.string().email(), z.literal('')]).nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  vendorCode: vendorCode.nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  currency: supplierCurrency.optional(),
  paymentTerms: z.string().max(100).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  services: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

const vatRate = z.number().min(0).max(100);
const unitPrice = z.number().nonnegative().max(1e12);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD');
const text = (max: number) => z.string().max(max).nullable().optional();
/** The longest email address there can be. */
const SUPPLIER_EMAIL_MAX = 320;

// The template's order details. Text fields take null (or blank) to clear.
const orderDetails = {
  projectNumber: text(64),
  // The supplier's contact and address on this order; filled from the supplier when left out.
  supplierContactName: text(200),
  supplierContactPhone: text(50),
  // The same rule as a supplier's imported email, so an order never refuses the email its supplier holds.
  // Blank, or spaces only, clears it, as for the other details.
  supplierContactEmail: z.string().trim().max(SUPPLIER_EMAIL_MAX)
    .refine((v) => v === '' || EMAIL_PATTERN.test(v), 'Not an email address').nullable().optional(),
  supplierAddress: text(500),
  paymentTerms: text(100),
  paymentMilestone: text(200),
  settlementDiscount: z.number().min(0).max(100).optional(),
  shippingTerms: text(200),
  penaltiesApply: z.boolean().optional(),
  deliveryMethod: z.enum(DELIVERY_METHODS).optional(),
  deliveryTo: text(200),
  deliveryAddress: text(500),
  deliveryCountry: text(100),
  deliveryContactName: text(200),
  deliveryContactPhone: text(50),
  afrinovContact: text(200),
};

export const createPOSchema = z.object({
  supplierId: supplierIdSchema,
  notes: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  vatRate: z.number().min(0).max(100).optional(),
  ...orderDetails,
  lines: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        orderedQty: z.number().positive(),
        unitPrice: z.number().nonnegative().max(1e12).optional(),
        deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD').optional(),
      }),
    )
    .min(1),
});

export const updatePOSchema = z.object({
  notes: z.string().optional(),
  expectedDeliveryDate: z.string().nullable().optional(),
  vatRate: vatRate.optional(),
  linePrices: z.array(z.object({ lineId: z.string().uuid(), unitPrice: unitPrice.nullable() })).max(500).optional(),
  lineDeliveryDates: z.array(z.object({ lineId: z.string().uuid(), deliveryDate: day.nullable() })).max(500).optional(),
  ...orderDetails,
});

export const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;

export const listPOQuerySchema = z.object({
  status: z.enum(PO_STATUSES).optional(),
  projectNumber: z.string().max(64).optional(),
  /** Only the orders pending approval that the signed-in user may approve now, oldest first. */
  awaitingMyApproval: z.enum(['true', 'false']).optional(),
});

export const receiveSchema = z.object({
  locationId: z.string().uuid(),
  deliveryNotes: z.string().max(2000).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const closeSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const createGRSchema = z.object({
  purchaseOrderId: z.string().uuid().optional(),
  supplierId: supplierIdSchema,
  deliveryRef: z.string().optional(),
  lines: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        locationId: z.string().uuid(),
        quantity: z.number().positive(),
        purchaseOrderLineId: z.string().uuid().optional(),
      }),
    )
    .min(1),
  /** Post it into stock as well, in the same step. */
  post: z.boolean().optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

// Suppliers are shared with inventory (stock items, reports), so they are
// always registered; purchase order and goods receipt routes are gated by
// PROCUREMENT_ENABLED in server.ts.
export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.get('/suppliers',{ preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string | undefined>).q;
    return SupplierService.list(q);
  });

  app.post('/suppliers', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreateSupplier);
    const parsed = createSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid supplier payload', details: parsed.error.flatten() },
      });
    }
    const created = await SupplierService.create(parsed.data, actorId(req));
    return reply.code(201).send(created);
  });

  app.get('/suppliers/:id', { preHandler: [app.authenticate] }, async (req) => {
    return SupplierService.getById((req.params as { id: string }).id);
  });

  // Edit, deactivate or reactivate. Suppliers are never deleted: receipts and
  // purchase orders keep pointing at them.
  app.patch('/suppliers/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.EditSupplier);
    const parsed = updateSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid supplier payload', details: parsed.error.flatten() },
      });
    }
    return SupplierService.update({ id: (req.params as { id: string }).id, ...parsed.data }, actorId(req));
  });
}

export async function procurementRoutes(app: FastifyInstance): Promise<void> {
  app.get('/purchase-orders', { preHandler: [app.authenticate] }, async (req, reply) => {
    // The list exposes PO numbers, statuses, and line quantities — the same
    // data the detail endpoint guards. Requiring the permission here closes
    // the enumeration gap (K6); VIEWER/APPROVER cannot list POs, matching
    // their inability to open a PO detail.
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    const parsed = listPOQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Unknown purchase order status', details: parsed.error.flatten() },
      });
    }
    if (parsed.data.awaitingMyApproval === 'true') return PurchaseOrderService.awaitingApproval(actorId(req));
    return PurchaseOrderService.list({ status: parsed.data.status, projectNumber: parsed.data.projectNumber });
  });
  app.get('/purchase-orders/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    const id = (req.params as { id: string }).id;
    return PurchaseOrderService.getById(id);
  });

  app.post('/purchase-orders', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const parsed = createPOSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid PO payload', details: parsed.error.flatten() },
      });
    }
    const created = await PurchaseOrderService.create(parsed.data, actorId(req));
    return reply.code(201).send(created);
  });

  app.patch('/purchase-orders/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const id = (req.params as { id: string }).id;
    const parsed = updatePOSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid PO payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.update({ id, ...parsed.data }, actorId(req));
  });

  app.get('/purchase-orders/:id/history', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    const id = (req.params as { id: string }).id;
    return PurchaseOrderService.history(id);
  });

  app.post('/purchase-orders/:id/submit', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.SubmitPurchaseOrder);
    const id = (req.params as { id: string }).id;
    return PurchaseOrderService.submit(id, actorId(req));
  });

  // Who may approve this order (by limit), and whether the asking user can.
  app.get('/purchase-orders/:id/approval', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    return PurchaseOrderService.approval((req.params as { id: string }).id, actorId(req));
  });

  app.post('/purchase-orders/:id/approve', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ApprovePurchaseOrder);
    const id = (req.params as { id: string }).id;
    return PurchaseOrderService.approve(id, actorId(req));
  });

  app.post('/purchase-orders/:id/receive', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ReceivePurchaseOrder);
    const id = (req.params as { id: string }).id;
    const parsed = receiveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid receive payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.receive({ id, ...parsed.data }, actorId(req));
  });

  app.post('/purchase-orders/:id/close', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ClosePurchaseOrder);
    const id = (req.params as { id: string }).id;
    const parsed = closeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid close payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.close({ id, ...parsed.data }, actorId(req));
  });

  app.post('/purchase-orders/:id/cancel', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CancelPurchaseOrder);
    const id = (req.params as { id: string }).id;
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid cancel payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.cancel({ id, ...parsed.data }, actorId(req));
  });

  app.get('/goods-receipts', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewGoodsReceipt);
    return GoodsReceiptService.list();
  });
  app.get('/goods-receipts/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewGoodsReceipt);
    const id = (req.params as { id: string }).id;
    return GoodsReceiptService.getById(id);
  });

  app.post('/goods-receipts', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ReceiveInventory);
    const parsed = createGRSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid goods receipt payload', details: parsed.error.flatten() },
      });
    }
    const { post, ...input } = parsed.data;
    const created = post
      ? await GoodsReceiptService.receive(input, actorId(req))
      : await GoodsReceiptService.create(input, actorId(req));
    return reply.code(201).send(created);
  });

  app.post('/goods-receipts/:id/post', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ReceiveInventory);
    const id = (req.params as { id: string }).id;
    const posted = await GoodsReceiptService.post(id, actorId(req));
    return reply.send(posted);
  });
}

// Audit lookup helper used in tests; not exposed via HTTP.
export async function auditEntriesForPurchaseOrder(id: string) {
  return prisma.auditLogEntry.findMany({
    where: { entityType: 'PurchaseOrder', entityId: id },
    orderBy: { createdAt: 'asc' },
  });
}