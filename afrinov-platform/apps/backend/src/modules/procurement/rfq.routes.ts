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

/**
 * A number with at most 4 decimal places, as a DECIMAL(18, 4) column keeps
 * it: its 4-place rounding must be the same number, to within the last bit a
 * double holds, so 0.000000001 is refused rather than saved as 0.
 */
export function fourDecimals(n: number): boolean {
  const kept = Math.round(n * 1e4) / 1e4;
  return Math.abs(n - kept) <= Number.EPSILON * Math.max(1, Math.abs(n)) * 8;
}

/** Prices are kept to 4 decimal places, excluding VAT, in the supplier's currency. */
const unitPrice = z.number().min(0).max(1e12).refine(fourDecimals, 'At most 4 decimal places');

export const recordQuoteSchema = z.object({
  /** When the quote came in; today unless given. */
  quotedAt: day.optional(),
  quoteReference: text(100),
  validUntil: day.nullable().optional(),
  leadTime: text(100),
  notes: text(2000),
  /** A price per line the supplier priced; lines they don't offer are left out. */
  prices: z.array(z.object({ rfqLineId: z.uuid(), unitPrice })).min(1).max(200),
});

export const declineQuoteSchema = z.object({ notes: text(2000) });

/** The supplier's quotation PDF; the rest of the API takes 1 MB. */
export const QUOTE_FILE_LIMIT = 10 * 1024 * 1024;

export const listRfqQuerySchema = z.object({
  status: z.enum(RFQ_STATUSES).optional(),
  projectNumber: z.string().max(64).optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

const invalid = (what: string, details: unknown) => ({ error: { code: 'VALIDATION_ERROR', message: `Invalid ${what}`, details } });

type QuoteParams = { id: string; supplierId: string };

// Registered with the purchase order routes, behind PROCUREMENT_ENABLED.
export async function rfqRoutes(app: FastifyInstance): Promise<void> {
  // A quotation PDF is sent as itself, not as JSON, with its name in a header.
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: QUOTE_FILE_LIMIT }, (_req, body, done) => done(null, body));

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

  app.put('/rfqs/:id/suppliers/:supplierId/quote', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const parsed = recordQuoteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid('quote', parsed.error.flatten()));
    const { id, supplierId } = req.params as QuoteParams;
    return RfqService.recordQuote(id, supplierId, parsed.data, actorId(req));
  });

  app.post('/rfqs/:id/suppliers/:supplierId/decline', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const parsed = declineQuoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send(invalid('decline', parsed.error.flatten()));
    const { id, supplierId } = req.params as QuoteParams;
    return RfqService.decline(id, supplierId, parsed.data, actorId(req));
  });

  // Who is sending it, and may they, is checked when the request arrives,
  // before up to 10 MB is read: nobody else gets that much held in memory.
  app.put('/rfqs/:id/suppliers/:supplierId/quote-file', {
    onRequest: [app.authenticate, async (req) => { await requirePermission(req, PermissionCode.CreatePurchaseOrder); }],
    bodyLimit: QUOTE_FILE_LIMIT,
  }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) {
      return reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send the quotation as application/pdf' } });
    }
    const header = req.headers['x-file-name'];
    let fileName = 'quotation.pdf';
    try {
      if (typeof header === 'string' && header) fileName = decodeURIComponent(header);
    } catch {
      return reply.code(400).send(invalid('file name', {}));
    }
    const { id, supplierId } = req.params as QuoteParams;
    return RfqService.putQuoteFile(id, supplierId, { fileName, data: req.body }, actorId(req));
  });

  app.get('/rfqs/:id/suppliers/:supplierId/quote-file', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    const { id, supplierId } = req.params as QuoteParams;
    const file = await RfqService.getQuoteFile(id, supplierId);
    // The name as attached, safely quoted for any browser.
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return reply
      .type('application/pdf')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .send(file.data);
  });

  app.delete('/rfqs/:id/suppliers/:supplierId/quote-file', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.CreatePurchaseOrder);
    const { id, supplierId } = req.params as QuoteParams;
    return RfqService.removeQuoteFile(id, supplierId, actorId(req));
  });

  app.get('/rfqs/:id/history', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewPurchaseOrder);
    return RfqService.history((req.params as { id: string }).id);
  });
}
