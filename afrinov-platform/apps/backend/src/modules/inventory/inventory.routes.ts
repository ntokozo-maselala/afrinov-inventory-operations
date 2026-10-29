import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

// Keep the pre-Zod-4 API contract: validate UUID shape without requiring RFC version bits.
const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
import { supplierIdSchema } from '../../shared/ids.js';
import { InventoryService, type HistoryFilter } from './inventory.service.js';
import { buildMovementsXlsx, movementsFilename, MOVEMENTS_EXPORT_LIMIT } from './movements-export.js';
import { prisma } from '../../shared/db.js';
import { StockReceiptService } from './stock-receipt.service.js';
import { StockCountService } from './stock-count.service.js';
import { locationsWithin } from './location.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import { Errors } from '../../shared/errors.js';
import {
  withIdempotency,
  readIdempotencyKey,
  sendIdempotent,
  type IdempotencyEndpoint,
} from '../../shared/idempotency.js';

/**
 * The locations a report covers: with inside=true, the location and the ones
 * standing inside it (a room and its racks); otherwise just the location, as
 * a plain locationId is (Count stock relies on that).
 */
async function locationScope(q: Record<string, string | undefined>): Promise<string[] | undefined> {
  return q['locationId'] && q['inside'] === 'true' ? locationsWithin(q['locationId']) : undefined;
}

/** The history filters a query string carries; shared by the list, its totals and the download. */
async function historyFilter(q: Record<string, string | undefined>): Promise<Omit<HistoryFilter, 'before' | 'limit'>> {
  return {
    locationIds: await locationScope(q),
    materialId: q['materialId'],
    type: q['type'],
    from: q['from'],
    to: q['to'],
    projectNumber: q['projectNumber'],
    locationId: q['locationId'],
    actorId: q['actorId'],
    recipientId: q['recipientId'],
    q: q['q'],
    report: (['issued', 'transfers', 'writeoffs', 'loans', 'returned'] as const).find((r) => r === q['report']),
  };
}

/** The filters in words, for the top of the download. */
async function describeHistoryFilter(f: Omit<HistoryFilter, 'before' | 'limit'>): Promise<string> {
  const [material, location, actor] = await Promise.all([
    f.materialId ? prisma.material.findUnique({ where: { id: f.materialId }, select: { sku: true } }) : null,
    f.locationId ? prisma.location.findUnique({ where: { id: f.locationId }, select: { name: true } }) : null,
    f.actorId ? prisma.user.findUnique({ where: { id: f.actorId }, select: { name: true } }) : null,
  ]);
  return [
    f.from || f.to ? `${f.from ?? 'the start'} to ${f.to ?? 'today'}` : 'All dates',
    f.report ? { issued: 'issued stock', transfers: 'transfers', writeoffs: 'write-offs and adjustments', loans: 'tool loans', returned: 'returned stock' }[f.report] : null,
    f.type ? `type ${f.type.replace(/_/g, ' ').toLowerCase()}` : null,
    material ? `item ${material.sku}` : null,
    location ? `at ${location.name}${f.locationIds && f.locationIds.length > 1 ? ' and the locations inside it' : ''}` : null,
    actor ? `by ${actor.name}` : null,
    f.projectNumber ? `project ${f.projectNumber}` : null,
    f.q?.trim() ? `matching "${f.q.trim()}"` : null,
  ].filter(Boolean).join(', ');
}

export const issueSchema = z.object({
  recipientId: uuidSchema,
  projectNumber: z.string().trim().min(1).max(64).optional(),
  lines: z.array(z.object({
    materialId: uuidSchema,
    locationId: uuidSchema,
    quantity: z.number().positive(),
  })).min(1).max(50),
});

export const transferSchema = z.object({
  materialId: uuidSchema,
  fromLocationId: uuidSchema,
  toLocationId: uuidSchema,
  quantity: z.number().positive(),
});

export const adjustmentSchema = z.object({
  materialId: uuidSchema,
  locationId: uuidSchema,
  quantity: z.number(),
  reasonCode: z.enum(['COUNT_VARIANCE', 'DAMAGE', 'LOSS', 'SCRAP', 'OTHER']),
  reasonNote: z.string().optional(),
});

export const stockReceiptSchema = z.object({
  supplierId: supplierIdSchema,
  deliveryRef: z.string().trim().min(1).max(120),
  receivedAt: z.string().optional(),
  lines: z.array(z.object({
    materialId: uuidSchema,
    locationId: uuidSchema,
    quantity: z.number().positive(),
  })).min(1).max(50),
});

export const stockCountSchema = z.object({
  locationId: uuidSchema,
  note: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    materialId: uuidSchema,
    expectedQuantity: z.number().min(0),
    countedQuantity: z.number().min(0),
    note: z.string().trim().max(200).optional(),
  })).min(1).max(2000),
});

export const returnSchema = z.object({
  quantity: z.number().positive(),
  locationId: uuidSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

/** Several returns at the counter, each against its own issue (POST /inventory-returns). */
export const returnManySchema = z.object({
  lines: z.array(z.object({
    issueTransactionId: z.string().min(1),
    quantity: z.number().positive(),
    locationId: uuidSchema.optional(),
  })).min(1).max(100),
  reason: z.string().trim().max(500).optional(),
});

export const returnableQuerySchema = z.object({
  recipientId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const reversalSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

/**
 * Run a mutating operation, making it retry-safe when the client sent an
 * `Idempotency-Key` header. With a key, the operation and the stored key commit
 * in one transaction, and a repeat replays the first response instead of
 * posting the movement again (TD-019). Without a key, the behaviour is exactly
 * as before: the operation opens and commits its own transaction.
 *
 * `run` receives the transaction to use (the idempotent one when a key was
 * sent, otherwise undefined, so the service opens its own) and returns the
 * status and body to send.
 */
async function idempotentMutation(
  req: FastifyRequest,
  reply: FastifyReply,
  endpoint: IdempotencyEndpoint,
  run: (tx: Prisma.TransactionClient | undefined) => Promise<{ statusCode: number; body: unknown }>,
): Promise<FastifyReply> {
  const read = readIdempotencyKey(req.headers as Record<string, unknown>);
  if (!read.present) {
    const fresh = await run(undefined);
    return reply.code(fresh.statusCode).send(fresh.body);
  }
  if (!read.valid) {
    // The caller asked for retry safety but the key cannot be stored. Refusing
    // is safer than silently running unkeyed: a retry of an unkeyed write could
    // post the movement twice.
    throw Errors.validation('Idempotency-Key must be 1-200 printable ASCII characters');
  }
  const outcome = await withIdempotency(
    { actorId: actorId(req), endpoint, key: read.key, scope: req.url, requestBody: req.body },
    (tx) => run(tx),
  );
  return sendIdempotent(reply, outcome, outcome.replayed);
}

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/inventory-transactions', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return InventoryService.queryHistory({
      ...(await historyFilter(q)),
      before: q['before'],
      limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  app.get('/inventory-transactions/summary', { preHandler: [app.authenticate] }, async (req) => {
    return InventoryService.historySummary(await historyFilter(req.query as Record<string, string | undefined>));
  });

  app.get('/inventory-transactions/actors', { preHandler: [app.authenticate] }, async () => {
    return InventoryService.historyActors();
  });

  app.get('/inventory-transactions/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    const filter = await historyFilter(req.query as Record<string, string | undefined>);
    const count = await InventoryService.historyCount(filter);
    if (count > MOVEMENTS_EXPORT_LIMIT) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: `These filters select ${count} movements; one download holds at most ${MOVEMENTS_EXPORT_LIMIT}. Choose a shorter date range.` },
      });
    }
    const rows = await InventoryService.queryHistory({ ...filter, limit: MOVEMENTS_EXPORT_LIMIT }, MOVEMENTS_EXPORT_LIMIT);
    const now = new Date();
    const buf = await buildMovementsXlsx(rows, { scope: await describeHistoryFilter(filter), generatedAt: now });
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${movementsFilename(filter.from, filter.to, now)}"`)
      .header('Content-Length', String(buf.length))
      .header('Cache-Control', 'no-store')
      .send(buf);
  });

  app.post('/inventory-issues', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.IssueInventory);
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid issue payload', details: parsed.error.flatten() },
      });
    }
    return idempotentMutation(req, reply, 'POST /inventory-issues', async (tx) => ({
      statusCode: 201,
      body: await InventoryService.issue({ ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  app.post('/inventory-transfers', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.TransferInventory);
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid transfer payload', details: parsed.error.flatten() },
      });
    }
    return idempotentMutation(req, reply, 'POST /inventory-transfers', async (tx) => ({
      statusCode: 201,
      body: await InventoryService.transfer({ ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  app.post('/inventory-adjustments', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.AdjustInventory);
    const parsed = adjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid adjustment payload', details: parsed.error.flatten() },
      });
    }
    return idempotentMutation(req, reply, 'POST /inventory-adjustments', async (tx) => ({
      statusCode: 201,
      body: await InventoryService.adjust({ ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  // A stock count by location; differences become COUNT_VARIANCE adjustments.
  app.post('/stock-counts', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.AdjustInventory);
    const parsed = stockCountSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid stock count payload', details: parsed.error.flatten() },
      });
    }
    return idempotentMutation(req, reply, 'POST /stock-counts', async (tx) => ({
      statusCode: 201,
      body: await StockCountService.post({ ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  // The issued-stock report: issue slips with their lines, newest first.
  app.get('/inventory-issues', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    return InventoryService.issueSlips({ ...(await historyFilter(q)), before: q['before'], limit: q['limit'] ? Number(q['limit']) : undefined });
  });

  // The received-stock report: deliveries with their lines, newest first.
  app.get('/stock-receipts', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    return StockReceiptService.list({
      from: q['from'], to: q['to'], supplierId: q['supplierId'], locationId: q['locationId'], locationIds: await locationScope(q), q: q['q'],
      before: q['before'], limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  // The stock-counts report: each count with its differences, newest first.
  app.get('/stock-counts', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    return StockCountService.list({
      from: q['from'], to: q['to'], locationId: q['locationId'], locationIds: await locationScope(q), actorId: q['actorId'],
      before: q['before'], limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  // Counter receipts work whether or not procurement is switched on.
  app.post('/stock-receipts', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ReceiveInventory);
    const parsed = stockReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid receipt payload', details: parsed.error.flatten() },
      });
    }
    return idempotentMutation(req, reply, 'POST /stock-receipts', async (tx) => ({
      statusCode: 201,
      body: await StockReceiptService.receive({ ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  // Stock coming back from an issue. Same people as issuing.
  app.post('/inventory-transactions/:id/returns', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.IssueInventory);
    const parsed = returnSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid return payload', details: parsed.error.flatten() },
      });
    }
    const { id } = req.params as { id: string };
    return idempotentMutation(req, reply, 'POST /inventory-transactions/:id/returns', async (tx) => ({
      statusCode: 201,
      body: await InventoryService.returnToStock({ issueTransactionId: id, ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  // What a recipient can still bring back, for the Return stock page.
  app.get('/inventory-returns/returnable', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const parsed = returnableQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Choose who is returning the stock', details: parsed.error.flatten() },
      });
    }
    return InventoryService.returnable(parsed.data);
  });

  // Several items coming back at once, all-or-nothing. Same people as issuing.
  app.post('/inventory-returns', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.IssueInventory);
    const parsed = returnManySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid return payload', details: parsed.error.flatten() },
      });
    }
    return idempotentMutation(req, reply, 'POST /inventory-returns', async (tx) => ({
      statusCode: 201,
      body: await InventoryService.returnMany({ ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  app.post('/inventory-transactions/:id/reversal', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ReverseInventoryTransaction);
    const parsed = reversalSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'A reason is required to reverse a movement', details: parsed.error.flatten() },
      });
    }
    const { id } = req.params as { id: string };
    return idempotentMutation(req, reply, 'POST /inventory-transactions/:id/reversal', async (tx) => ({
      statusCode: 201,
      body: await InventoryService.reverse({ transactionId: id, reason: parsed.data.reason, actorId: actorId(req) }, tx),
    }));
  });
}