import type { FastifyInstance, FastifyRequest } from 'fastify';
import { idempotentMutation } from '../../shared/idempotency.js';
import { z } from 'zod';
import { supplierIdSchema } from '../../shared/ids.js';
import { DELIVERY_METHODS, ORDER_KINDS, PurchaseOrderService, SupplierService, kindOfOrder } from './procurement.service.js';
import { Errors } from '../../shared/errors.js';
import { fourDecimals } from './rfq.routes.js';
import { storedQuantity } from '../../shared/decimal.js';
import { GoodsReceiptService } from './goods-receipt.service.js';
import { listOrderedFor } from './ordered-for.js';
import { COUNTER_RECEIPTS_OFF } from '../inventory/inventory.routes.js';
import { EMAIL_PATTERN, SUPPLIER_CURRENCIES, cleanText } from './supplier-fields.js';
import { PermissionCode, type PermissionCodeValue } from '../../shared/permissions.js';
import { requirePermission, userHasPermission } from '../../shared/authorization.js';
import { prisma } from '../../shared/db.js';

const supplierCurrency = z.enum(SUPPLIER_CURRENCIES);
const vendorCode = z.string().trim().max(20).regex(/^[A-Za-z0-9-]*$/, 'Letters, digits and dashes only');

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: z.string().max(200).optional(),
  contactEmail: z.email().optional(),
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
  contactEmail: z.union([z.email(), z.literal('')]).nullable().optional(),
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
// Kept to 4 decimal places, as the order line keeps it.
const unitPrice = z.number().nonnegative().max(1e12).refine(fourDecimals, 'At most 4 decimal places');
/** Percent off a line's unit price, to 4 places, as a supplier's discount may need (Procurement KPIs count the saving). */
const discountPercent = z.number().min(0).max(100).refine(fourDecimals, 'At most 4 decimal places');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD');
/** A line named at most once, so each change is compared with what the line had. */
const oncePerLine = (rows: Array<{ lineId: string }>) => new Set(rows.map((r) => r.lineId)).size === rows.length;
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
        materialId: z.uuid(),
        orderedQty: storedQuantity,
        unitPrice: unitPrice.optional(),
        discountPercent: discountPercent.optional(),
        deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD').optional(),
      }),
    )
    .min(1),
});

export const updatePOSchema = z.object({
  notes: z.string().optional(),
  expectedDeliveryDate: z.string().nullable().optional(),
  vatRate: vatRate.optional(),
  linePrices: z.array(z.object({ lineId: z.uuid(), unitPrice: unitPrice.nullable() })).max(500).refine(oncePerLine, 'A line can be priced once per change').optional(),
  lineDiscounts: z.array(z.object({ lineId: z.uuid(), discountPercent })).max(500).refine(oncePerLine, 'A line can be discounted once per change').optional(),
  lineDeliveryDates: z.array(z.object({ lineId: z.uuid(), deliveryDate: day.nullable() })).max(500).optional(),
  ...orderDetails,
});

export const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;

export const listPOQuerySchema = z.object({
  status: z.enum(PO_STATUSES).optional(),
  projectNumber: z.string().max(64).optional(),
  /** Stores orders (no project) or project orders. */
  kind: z.enum(ORDER_KINDS).optional(),
  /** Only the orders pending approval that the signed-in user may approve now, oldest first. */
  awaitingMyApproval: z.enum(['true', 'false']).optional(),
});

export const confirmDeliverySchema = z.object({
  // Kept to 4 decimal places, as the order line keeps it, so what is recorded is what is credited.
  lines: z.array(z.object({ lineId: z.uuid(), quantity: z.number().positive().max(1e9).refine(fourDecimals, 'At most 4 decimal places') })).min(1).max(500),
  deliveryRef: z.string().trim().max(120).optional(),
  deliveredOn: z.iso.date().optional(),
});

export const cancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const closeSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const createGRSchema = z.object({
  purchaseOrderId: z.uuid().optional(),
  supplierId: supplierIdSchema,
  deliveryRef: z.string().optional(),
  // The date on the delivery note, as Receive stock sends it; now when left out.
  receivedAt: z.string().max(40).optional(),
  lines: z
    .array(
      z.object({
        materialId: z.uuid(),
        locationId: z.uuid(),
        quantity: storedQuantity,
        purchaseOrderLineId: z.uuid().optional(),
      }),
    )
    .min(1),
  /** Post it into stock as well, in the same step. */
  post: z.boolean().optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

/**
 * Ordering is split by kind (Stores ordering roadmap): an order with a
 * project is Procurement's, needing the purchase order permission given; one
 * without is Stores stock, ordered by the store with order:stores_stock.
 */
async function requireForKind(req: FastifyRequest, projectNumber: string | null | undefined, forProject: PermissionCodeValue): Promise<void> {
  await requirePermission(req, cleanText(projectNumber) ? forProject : PermissionCode.OrderStoresStock);
}

/**
 * Which kinds of order this user sees (Stores and Procurement Separation
 * Roadmap): Stores orders with order:stores_stock, or approve:stores_order for
 * those who sign them; project orders with view:purchase_order. Each side's
 * orders are not found to the other.
 */
async function kindsSeen(req: FastifyRequest): Promise<{ stores: boolean; projects: boolean }> {
  return {
    stores: await userHasPermission(req, PermissionCode.OrderStoresStock) || await userHasPermission(req, PermissionCode.ApproveStoresOrder),
    projects: await userHasPermission(req, PermissionCode.ViewPurchaseOrder),
  };
}

/** Refuses an order the user can't see: not found, so they can't tell it exists. */
async function requireSeesOrder(req: FastifyRequest, po: { projectNumber: string | null }): Promise<void> {
  const seen = await kindsSeen(req);
  if (!seen[kindOfOrder(po)]) throw Errors.notFound('PurchaseOrder');
}

/**
 * As requireForKind, for an existing order. Someone who may change neither
 * kind is refused before the order is looked up, so they can't learn which
 * orders exist; for an order that doesn't exist, the service answers 404.
 * An order of the other side's is not found.
 */
async function requireForOrder(req: FastifyRequest, id: string, forProject: PermissionCodeValue): Promise<void> {
  if (!(await userHasPermission(req, forProject)) && !(await userHasPermission(req, PermissionCode.OrderStoresStock))) {
    await requirePermission(req, forProject);
  }
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { projectNumber: true } });
  if (!po) return;
  await requireSeesOrder(req, po);
  await requirePermission(req, kindOfOrder(po) === 'projects' ? forProject : PermissionCode.OrderStoresStock);
}

/** Signing an order: each kind has its permission. Which step they may sign is the service's to decide. */
async function requireApproveOrder(req: FastifyRequest, id: string): Promise<void> {
  if (!(await userHasPermission(req, PermissionCode.ApprovePurchaseOrder)) && !(await userHasPermission(req, PermissionCode.ApproveStoresOrder))) {
    await requirePermission(req, PermissionCode.ApprovePurchaseOrder);
  }
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { projectNumber: true } });
  if (!po) return;
  await requireSeesOrder(req, po);
  await requirePermission(req, kindOfOrder(po) === 'projects' ? PermissionCode.ApprovePurchaseOrder : PermissionCode.ApproveStoresOrder);
}

/**
 * Which kinds of order this user receives into the store (Project Material
 * Through the Store Roadmap, Phase 2): Stores orders with order:stores_stock,
 * as before, and project orders with receive:purchase_order, which the store
 * controller holds. Receiving a project order shows only what receiving needs.
 */
async function kindsReceived(req: FastifyRequest): Promise<{ stores: boolean; projects: boolean }> {
  return {
    stores: await userHasPermission(req, PermissionCode.OrderStoresStock),
    projects: await userHasPermission(req, PermissionCode.ReceivePurchaseOrder),
  };
}

/**
 * Receiving against an existing order: refused unless this user receives its
 * kind. Someone who can see the order is forbidden; anyone else gets not
 * found, so they can't tell it exists. For an order that doesn't exist, the
 * service answers 404.
 */
async function requireReceiveOrder(req: FastifyRequest, id: string): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { projectNumber: true } });
  if (!po) return;
  const kind = kindOfOrder(po);
  if ((await kindsReceived(req))[kind]) return;
  if ((await kindsSeen(req))[kind]) await requirePermission(req, kind === 'projects' ? PermissionCode.ReceivePurchaseOrder : PermissionCode.OrderStoresStock);
  throw Errors.notFound('PurchaseOrder');
}

/** A receipt is seen by whoever sees its order, or receives orders of its kind. */
async function receiptKindsSeen(req: FastifyRequest): Promise<{ stores: boolean; projects: boolean }> {
  const [seen, received] = [await kindsSeen(req), await kindsReceived(req)];
  return { stores: seen.stores || received.stores, projects: seen.projects || received.projects };
}

/** Viewing an order: the store sees Stores orders, Procurement and approvers project orders. */
async function requireViewOrder(req: FastifyRequest, id: string): Promise<void> {
  const seen = await kindsSeen(req);
  if (!seen.stores && !seen.projects) await requirePermission(req, PermissionCode.ViewPurchaseOrder);
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { projectNumber: true } });
  if (po) await requireSeesOrder(req, po);
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
    // the enumeration gap (K6): only those who see one kind or the other list.
    const seen = await kindsSeen(req);
    if (!seen.stores && !seen.projects) await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    const parsed = listPOQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid purchase order filter', details: parsed.error.flatten() },
      });
    }
    // Each side lists only its own: Stores orders to the store, project orders to Procurement and approvers.
    const asked = parsed.data.kind;
    if (asked && !seen[asked]) return [];
    const kind = seen.stores && seen.projects ? asked : seen.stores ? 'stores' : 'projects';
    if (parsed.data.awaitingMyApproval === 'true') return PurchaseOrderService.awaitingApproval(actorId(req), kind);
    return PurchaseOrderService.list({ status: parsed.data.status, projectNumber: parsed.data.projectNumber, kind });
  });
  // Orders waiting for delivery that this user receives, for Receive stock:
  // the store's own, and project orders for those who receive them, in a
  // receiving view with no prices (Project Material Through the Store Roadmap).
  app.get('/purchase-orders/receivable', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ReceiveInventory);
    return PurchaseOrderService.receivable(await kindsReceived(req));
  });

  // Which projects each item was ordered for, for "Ordered for" on Materials.
  // Project numbers only, no prices: for those who see project orders, and the
  // store, which receives them and issues the material to its project.
  app.get('/purchase-orders/projects-by-material', { preHandler: [app.authenticate] }, async (req) => {
    if (!(await userHasPermission(req, PermissionCode.ReceivePurchaseOrder))) await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    return listOrderedFor();
  });

  app.get('/purchase-orders/:id', { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    await requireViewOrder(req, id);
    return PurchaseOrderService.getById(id);
  });

  app.post('/purchase-orders', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!(await userHasPermission(req, PermissionCode.OrderStoresStock))) await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const parsed = createPOSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid PO payload', details: parsed.error.flatten() },
      });
    }
    await requireForKind(req, parsed.data.projectNumber, PermissionCode.CreatePurchaseOrder);
    const created = await PurchaseOrderService.create(parsed.data, actorId(req));
    return reply.code(201).send(created);
  });

  app.patch('/purchase-orders/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await requireForOrder(req, id, PermissionCode.CreatePurchaseOrder);
    const parsed = updatePOSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid PO payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.update({ id, ...parsed.data }, actorId(req));
  });

  app.get('/purchase-orders/:id/history', { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    await requireViewOrder(req, id);
    return PurchaseOrderService.history(id);
  });

  app.post('/purchase-orders/:id/submit', { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    await requireForOrder(req, id, PermissionCode.SubmitPurchaseOrder);
    return PurchaseOrderService.submit(id, actorId(req));
  });

  // The signatures this order needs, who may give the next, and whether the asking user can.
  app.get('/purchase-orders/:id/approval', { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    await requireViewOrder(req, id);
    return PurchaseOrderService.approval(id, actorId(req));
  });

  app.post('/purchase-orders/:id/approve', { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    await requireApproveOrder(req, id);
    return PurchaseOrderService.approve(id, actorId(req));
  });

  app.post('/purchase-orders/:id/receive', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ReceivePurchaseOrder);
    const id = (req.params as { id: string }).id;
    // A Stores order by the store, a project order by those who receive orders into the store.
    await requireReceiveOrder(req, id);
    // Retired (system audit D3): every delivery is received on Receive stock.
    return PurchaseOrderService.receive({ id }, actorId(req));
  });

  // Retired: project material comes through the store, so a project order's
  // delivery is received on Receive stock (Project Material Through the Store
  // Roadmap, Phase 2). The service refuses, pointing there.
  app.post('/purchase-orders/:id/confirm-delivery', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await requireForOrder(req, id, PermissionCode.CreatePurchaseOrder);
    const parsed = confirmDeliverySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid delivery confirmation', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.confirmDelivery({ id, ...parsed.data }, actorId(req));
  });

  app.post('/purchase-orders/:id/close', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await requireForOrder(req, id, PermissionCode.ClosePurchaseOrder);
    const parsed = closeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid close payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.close({ id, ...parsed.data }, actorId(req));
  });

  app.post('/purchase-orders/:id/cancel', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await requireForOrder(req, id, PermissionCode.CancelPurchaseOrder);
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid cancel payload', details: parsed.error.flatten() },
      });
    }
    return PurchaseOrderService.cancel({ id, ...parsed.data }, actorId(req));
  });

  // A receipt against a Stores order is the store's, as the order is: left
  // out of the list, and not found, for anyone outside the store. One against
  // a project order is seen by Procurement and by those who receive it.
  app.get('/goods-receipts', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewGoodsReceipt);
    const receipts = await GoodsReceiptService.list();
    const seen = await receiptKindsSeen(req);
    return receipts.filter((gr) => !gr.purchaseOrder || seen[kindOfOrder(gr.purchaseOrder)]);
  });
  app.get('/goods-receipts/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewGoodsReceipt);
    const id = (req.params as { id: string }).id;
    const gr = await GoodsReceiptService.getById(id);
    if (gr.purchaseOrder && !(await receiptKindsSeen(req))[kindOfOrder(gr.purchaseOrder)]) throw Errors.notFound('GoodsReceipt');
    return gr;
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
    // Every delivery to the store is against an approved order: one with no
    // order is refused, as a counter receipt is while procurement is on.
    if (!input.purchaseOrderId) throw Errors.validation(COUNTER_RECEIPTS_OFF);
    // A Stores order by the store; a project order by those who receive orders
    // into the store, its stock held for the project.
    await requireReceiveOrder(req, input.purchaseOrderId);
    // Retry-safe with an Idempotency-Key, as Receive stock sends one: a
    // retried delivery replays the first receipt instead of booking it twice.
    return idempotentMutation(req, reply, 'POST /goods-receipts', async (tx) => ({
      statusCode: 201,
      body: post
        ? await GoodsReceiptService.receive(input, actorId(req), tx)
        : await GoodsReceiptService.create(input, actorId(req), {}, tx),
    }));
  });

  app.post('/goods-receipts/:id/post', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ReceiveInventory);
    const id = (req.params as { id: string }).id;
    // As when it was recorded (Qodo, PR #121): whoever receives the order's kind.
    const saved = await prisma.goodsReceipt.findUnique({ where: { id }, select: { purchaseOrderId: true } });
    // One saved with no order, before receipts needed one, isn't posted
    // into stock either (Qodo, PR #125).
    if (saved && !saved.purchaseOrderId) throw Errors.validation(COUNTER_RECEIPTS_OFF);
    if (saved?.purchaseOrderId) await requireReceiveOrder(req, saved.purchaseOrderId);
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