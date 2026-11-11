// Sales requests for quotation (see sales-rfq.service.ts) and the labour rates
// they price labour at (labour-rate.service.ts). Guarded by their own
// permissions rather than the purchase order ones: buyers and the store must
// not see what a job is priced at or its margin.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '../../shared/errors.js';
import { supplierIdSchema } from '../../shared/ids.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission, userHasPermission } from '../../shared/authorization.js';
import { cancelRfqSchema, rfqDay, rfqText } from '../procurement/rfq.routes.js';
import { SalesRfqService } from './sales-rfq.service.js';
import { LabourRateService } from './labour-rate.service.js';

export const SALES_RFQ_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'] as const;

const money = z.number().min(0).max(1e12);
const salesFields = {
  equipment: rfqText(200),
  description: rfqText(500),
  notes: rfqText(2000),
  penaltiesApply: z.boolean().optional(),
  markupPercent: z.number().min(0).max(1000).nullable().optional(),
  deliveryPrice: money.optional(),
  closingDate: rfqDay.nullable().optional(),
  clientName: rfqText(200),
  clientAddress: rfqText(1000),
  contactName: rfqText(200),
  clientReference: rfqText(200),
  paymentTerms: rfqText(300),
  validity: rfqText(300),
  deliveryDuration: rfqText(300),
  deliveryTerms: rfqText(300),
  signerPhone: rfqText(60),
  signerEmail: rfqText(200),
  labour: z.array(z.object({ labourRateId: z.uuid(), hours: z.number().min(0.01).max(100000) })).max(100).optional(),
  // One supplier's whole quote per Procurement RFQ.
  materials: z.array(z.object({ rfqId: z.uuid(), supplierId: supplierIdSchema })).max(50).optional(),
};

export const createSalesRfqSchema = z.object({ projectNumber: z.string().trim().min(1).max(64), ...salesFields });

// Fields left out are unchanged; null (or blank) clears a text field.
export const updateSalesRfqSchema = z.object({ projectNumber: z.string().trim().min(1).max(64).optional(), ...salesFields });

export const listSalesRfqQuerySchema = z.object({
  status: z.enum(SALES_RFQ_STATUSES).optional(),
  projectNumber: z.string().max(64).optional(),
});

export const salesQuoteOptionsQuerySchema = z.object({ projectNumber: z.string().trim().min(1).max(64) });

export const sendBackSalesRfqSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

export const createLabourRateSchema = z.object({ role: z.string().trim().min(1).max(100), hourlyRate: z.number().gt(0).max(1e7) });
export const updateLabourRateSchema = z.object({
  role: z.string().trim().min(1).max(100).optional(),
  hourlyRate: z.number().gt(0).max(1e7).optional(),
  active: z.boolean().optional(),
});
export const listLabourRatesQuerySchema = z.object({ active: z.enum(['true', 'false']).optional() });

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

/** The body, or a 400 for what is wrong with it. */
function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw Errors.validation(`Invalid ${what}`, parsed.error.flatten());
  return parsed.data;
}

const idOf = (req: { params: unknown }) => (req.params as { id: string }).id;

// Registered with the purchase order routes, behind PROCUREMENT_ENABLED.
export async function salesRfqRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sales-rfqs', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewSalesRfq);
    return SalesRfqService.list(parse(listSalesRfqQuerySchema, req.query ?? {}, 'Sales RFQ filter'));
  });

  // The Procurement quotes a Sales RFQ can take its material from. Before /:id, as Fastify prefers the fixed path anyway.
  app.get('/sales-rfqs/quote-options', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return SalesRfqService.quoteOptions(parse(salesQuoteOptionsQuerySchema, req.query ?? {}, 'project').projectNumber);
  });

  app.get('/sales-rfqs/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewSalesRfq);
    return SalesRfqService.getById(idOf(req));
  });

  app.post('/sales-rfqs', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return reply.code(201).send(await SalesRfqService.create(parse(createSalesRfqSchema, req.body, 'Sales RFQ'), actorId(req)));
  });

  app.patch('/sales-rfqs/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return SalesRfqService.update({ id: idOf(req), ...parse(updateSalesRfqSchema, req.body, 'Sales RFQ') }, actorId(req));
  });

  app.post('/sales-rfqs/:id/submit', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return SalesRfqService.submit(idOf(req), actorId(req));
  });

  app.post('/sales-rfqs/:id/approve', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ApproveSalesRfq);
    return SalesRfqService.approve(idOf(req), actorId(req));
  });

  app.post('/sales-rfqs/:id/send-back', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ApproveSalesRfq);
    return SalesRfqService.sendBack(idOf(req), parse(sendBackSalesRfqSchema, req.body ?? {}, 'reason').reason, actorId(req));
  });

  app.post('/sales-rfqs/:id/cancel', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSalesRfq);
    return SalesRfqService.cancel(idOf(req), parse(cancelRfqSchema, req.body ?? {}, 'cancellation').reason, actorId(req));
  });

  app.get('/sales-rfqs/:id/history', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewSalesRfq);
    return SalesRfqService.history(idOf(req));
  });

  // Sales reads the rates to price labour; the Workshop Manager keeps them.
  app.get('/labour-rates', { preHandler: [app.authenticate] }, async (req) => {
    if (!(await userHasPermission(req, PermissionCode.ManageLabourRates))) await requirePermission(req, PermissionCode.ViewSalesRfq);
    const { active } = parse(listLabourRatesQuerySchema, req.query ?? {}, 'filter');
    return LabourRateService.list(active === undefined ? {} : { active: active === 'true' });
  });

  app.post('/labour-rates', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageLabourRates);
    return reply.code(201).send(await LabourRateService.create(parse(createLabourRateSchema, req.body, 'labour rate'), actorId(req)));
  });

  app.patch('/labour-rates/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageLabourRates);
    return LabourRateService.update(idOf(req), parse(updateLabourRateSchema, req.body, 'labour rate'), actorId(req));
  });
}
