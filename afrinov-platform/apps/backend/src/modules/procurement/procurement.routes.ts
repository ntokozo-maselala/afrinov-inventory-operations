import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PurchaseOrderService, SupplierService } from './procurement.service.js';
import { GoodsReceiptService } from './goods-receipt.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import { prisma } from '../../shared/db.js';

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  notes: z.string().optional(),
});

export const createPOSchema = z.object({
  supplierId: z.string().uuid(),
  notes: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  lines: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        orderedQty: z.number().positive(),
        unitPrice: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

export const updatePOSchema = z.object({
  notes: z.string().optional(),
  expectedDeliveryDate: z.string().nullable().optional(),
});

export const shipSchema = z.object({
  trackingNumber: z.string().max(120).optional(),
  carrier: z.string().max(120).optional(),
  shipmentNotes: z.string().max(2000).optional(),
});

export const deliverSchema = z.object({
  locationId: z.string().uuid(),
  deliveryNotes: z.string().max(2000).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const createGRSchema = z.object({
  purchaseOrderId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
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
}

export async function procurementRoutes(app: FastifyInstance): Promise<void> {
  app.get('/purchase-orders',{ preHandler: [app.authenticate] }, async (req) => {
    // The list exposes PO numbers, statuses, and line quantities — the same
    // data the detail endpoint guards. Requiring the permission here closes
    // the enumeration gap (K6); VIEWER/APPROVER cannot list POs, matching
    // their inability to open a PO detail.
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    const q = (req.query as Record<string, string | undefined>).status;
    return PurchaseOrderService.list({ status: q as 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | undefined });
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

  app.post('/purchase-orders/:id/approve', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ApprovePurchaseOrder);
    const id = (req.params as { id: string }).id;
    return PurchaseOrderService.approve(id, actorId(req));
  });

  app.post('/purchase-orders/:id/ship', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ShipPurchaseOrder);
    const id = (req.params as { id: string }).id;
    const parsed = shipSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid ship payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.ship({ id, ...parsed.data }, actorId(req));
  });

  app.post('/purchase-orders/:id/deliver', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.DeliverPurchaseOrder);
    const id = (req.params as { id: string }).id;
    const parsed = deliverSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid deliver payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.deliver({ id, ...parsed.data }, actorId(req));
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
    const created = await GoodsReceiptService.create(parsed.data, actorId(req));
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