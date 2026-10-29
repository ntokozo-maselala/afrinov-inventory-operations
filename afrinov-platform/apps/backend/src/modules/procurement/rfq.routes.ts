import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supplierIdSchema } from '../../shared/ids.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import { RfqService } from './rfq.service.js';

// Requests for quotation use the purchase order permissions: whoever raises
// orders raises, sends and awards RFQs, and whoever may open an order may open one.

export const RFQ_STATUSES = ['DRAFT', 'SENT', 'AWARDED', 'CANCELLED'] as const;

const text = (max: number) => z.string().max(max).nullable().optional();
/** Quantities are kept to 4 decimal places, so a finer one would be saved as something else, or 0. */
export const rfqQuantity = z.number().min(0.0001).max(1e9)
  .refine((q) => Math.abs(q * 1e4 - Math.round(q * 1e4)) < 1e-6, 'At most 4 decimal places');
const rfqLines = z
  .array(z.object({ materialId: z.uuid(), quantity: rfqQuantity }))
  .min(1)
  .max(200);
const supplierIds = z.array(supplierIdSchema).max(50);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const createRfqSchema = z.object({
  projectNumber: text(64),
  description: text(500),
  notes: text(2000),
  penaltiesApply: z.boolean().optional(),
  lines: rfqLines,
  supplierIds: supplierIds.optional(),
});

// Fields left out are unchanged; null (or blank) clears a text field.
export const updateRfqSchema = z.object({
  projectNumber: text(64),
  description: text(500),
  notes: text(2000),
  penaltiesApply: z.boolean().optional(),
  lines: rfqLines.optional(),
  supplierIds: supplierIds.optional(),
  /** Only once it is sent. */
  closingDate: day.optional(),
});

/** Left out: four days after it is sent, as on the RFQ sheet. */
export const sendRfqSchema = z.object({ closingDate: day.optional() });

export const cancelRfqSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const listRfqQuerySchema = z.object({
  status: z.enum(RFQ_STATUSES).optional(),
  projectNumber: z.string().max(64).optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

const invalid = (what: string, details: unknown) => ({ error: { code: 'VALIDATION_ERROR', message: `Invalid ${what}`, details } });

// Registered with the purchase order routes, behind PROCUREMENT_ENABLED.
export async function rfqRoutes(app: FastifyInstance): Promise<void> {
  app.get('/rfqs', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    const parsed = listRfqQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send(invalid('request for quotation filter', parsed.error.flatten()));
    return RfqService.list(parsed.data);
  });

  app.get('/rfqs/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    return RfqService.getById((req.params as { id: string }).id);
  });

  app.post('/rfqs', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const parsed = createRfqSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid('request for quotation', parsed.error.flatten()));
    return reply.code(201).send(await RfqService.create(parsed.data, actorId(req)));
  });

  app.patch('/rfqs/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const parsed = updateRfqSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid('request for quotation', parsed.error.flatten()));
    return RfqService.update({ id: (req.params as { id: string }).id, ...parsed.data }, actorId(req));
  });

  app.post('/rfqs/:id/send', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const parsed = sendRfqSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send(invalid('closing date', parsed.error.flatten()));
    return RfqService.send((req.params as { id: string }).id, parsed.data, actorId(req));
  });

  app.post('/rfqs/:id/cancel', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const parsed = cancelRfqSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send(invalid('cancellation', parsed.error.flatten()));
    return RfqService.cancel((req.params as { id: string }).id, parsed.data.reason, actorId(req));
  });

  app.get('/rfqs/:id/history', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    return RfqService.history((req.params as { id: string }).id);
  });
}
