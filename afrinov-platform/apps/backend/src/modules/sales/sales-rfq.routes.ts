// Sales requests for quotation (see sales-rfq.service.ts). Guarded by their own
// permissions rather than the purchase order ones: buyers and the store must not
// see what Sales was quoted.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '../../shared/errors.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import {
  QUOTE_FILE_LIMIT, cancelRfqSchema, declineQuoteSchema, recordQuoteSchema, rfqDay, rfqQuantity, rfqSupplierIds, rfqText, sendRfqSchema,
} from '../procurement/rfq.routes.js';
import { SalesRfqService } from './sales-rfq.service.js';

export const SALES_RFQ_STATUSES = ['DRAFT', 'SENT', 'CANCELLED'] as const;

const salesRfqLines = z
  .array(z.object({
    description: z.string().trim().min(1).max(500),
    unitOfMeasure: z.string().trim().min(1).max(32),
    quantity: rfqQuantity,
  }))
  .min(1)
  .max(200);

export const createSalesRfqSchema = z.object({
  projectNumber: z.string().trim().min(1).max(64),
  description: rfqText(500),
  notes: rfqText(2000),
  penaltiesApply: z.boolean().optional(),
  lines: salesRfqLines,
  supplierIds: rfqSupplierIds.optional(),
});

// Fields left out are unchanged; null (or blank) clears a text field.
export const updateSalesRfqSchema = z.object({
  projectNumber: z.string().trim().min(1).max(64).optional(),
  description: rfqText(500),
  notes: rfqText(2000),
  penaltiesApply: z.boolean().optional(),
  lines: salesRfqLines.optional(),
  supplierIds: rfqSupplierIds.optional(),
  /** Only once it is sent. */
  closingDate: rfqDay.optional(),
});

export const listSalesRfqQuerySchema = z.object({
  status: z.enum(SALES_RFQ_STATUSES).optional(),
  projectNumber: z.string().max(64).optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

/** The body, or a 400 for what is wrong with it. */
function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw Errors.validation(`Invalid ${what}`, parsed.error.flatten());
  return parsed.data;
}

type QuoteParams = { id: string; supplierId: string };

// Registered with the purchase order routes, behind PROCUREMENT_ENABLED.
export async function salesRfqRoutes(app: FastifyInstance): Promise<void> {
  // A quotation PDF is sent as itself, not as JSON, with its name in a header.
  if (!app.hasContentTypeParser('application/pdf')) {
    app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: QUOTE_FILE_LIMIT }, (_req, body, done) => done(null, body));
  }

  app.get('/sales-rfqs', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewSalesRfq);
    return SalesRfqService.list(parse(listSalesRfqQuerySchema, req.query ?? {}, 'Sales RFQ filter'));
  });

  app.get('/sales-rfqs/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewSalesRfq);
    return SalesRfqService.getById((req.params as { id: string }).id);
  });

  app.post('/sales-rfqs', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return reply.code(201).send(await SalesRfqService.create(parse(createSalesRfqSchema, req.body, 'Sales RFQ'), actorId(req)));
  });

  app.patch('/sales-rfqs/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return SalesRfqService.update({ id: (req.params as { id: string }).id, ...parse(updateSalesRfqSchema, req.body, 'Sales RFQ') }, actorId(req));
  });

  app.post('/sales-rfqs/:id/send', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return SalesRfqService.send((req.params as { id: string }).id, parse(sendRfqSchema, req.body ?? {}, 'closing date'), actorId(req));
  });

  app.post('/sales-rfqs/:id/cancel', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return SalesRfqService.cancel((req.params as { id: string }).id, parse(cancelRfqSchema, req.body ?? {}, 'cancellation').reason, actorId(req));
  });

  app.put('/sales-rfqs/:id/suppliers/:supplierId/quote', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    const { id, supplierId } = req.params as QuoteParams;
    return SalesRfqService.recordQuote(id, supplierId, parse(recordQuoteSchema, req.body, 'quote'), actorId(req));
  });

  app.post('/sales-rfqs/:id/suppliers/:supplierId/decline', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    const { id, supplierId } = req.params as QuoteParams;
    return SalesRfqService.decline(id, supplierId, parse(declineQuoteSchema, req.body ?? {}, 'decline'), actorId(req));
  });

  // Who is sending it, and may they, is checked when the request arrives,
  // before up to 10 MB is read: nobody else gets that much held in memory.
  app.put('/sales-rfqs/:id/suppliers/:supplierId/quote-file', {
    onRequest: [app.authenticate, async (req) => { await requirePermission(req, PermissionCode.ManageSalesRfq); }],
    bodyLimit: QUOTE_FILE_LIMIT,
  }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw Errors.validation('Send the quotation as application/pdf');
    const header = req.headers['x-file-name'];
    let fileName = 'quotation.pdf';
    try {
      if (typeof header === 'string' && header) fileName = decodeURIComponent(header);
    } catch {
      throw Errors.validation('Invalid file name');
    }
    const { id, supplierId } = req.params as QuoteParams;
    return SalesRfqService.putQuoteFile(id, supplierId, { fileName, data: req.body }, actorId(req));
  });

  app.get('/sales-rfqs/:id/suppliers/:supplierId/quote-file', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ViewSalesRfq);
    const { id, supplierId } = req.params as QuoteParams;
    const file = await SalesRfqService.getQuoteFile(id, supplierId);
    // The name as attached, safely quoted for any browser.
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return reply
      .type('application/pdf')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .send(file.data);
  });

  app.delete('/sales-rfqs/:id/suppliers/:supplierId/quote-file', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    const { id, supplierId } = req.params as QuoteParams;
    return SalesRfqService.removeQuoteFile(id, supplierId, actorId(req));
  });

  app.get('/sales-rfqs/:id/history', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewSalesRfq);
    return SalesRfqService.history((req.params as { id: string }).id);
  });
}
