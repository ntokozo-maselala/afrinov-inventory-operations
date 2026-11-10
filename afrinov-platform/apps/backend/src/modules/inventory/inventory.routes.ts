import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

// Keep the pre-Zod-4 API contract: validate UUID shape without requiring RFC version bits.
const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
import { supplierIdSchema } from '../../shared/ids.js';
import { InventoryService, type HistoryFilter } from './inventory.service.js';
import { ConsumableOutcomeService } from './consumable-outcome.service.js';
import { buildMovementsXlsx, movementsFilename, MOVEMENTS_EXPORT_LIMIT } from './movements-export.js';
import { prisma } from '../../shared/db.js';
import { storedQuantity, storedCount, storedSignedQuantity } from '../../shared/decimal.js';
import { StockReceiptService } from './stock-receipt.service.js';
import { StockCountService } from './stock-count.service.js';
import { WriteOffApprovalService } from './write-off-approval.service.js';
import { locationsWithin } from './location.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission, userHasPermission } from '../../shared/authorization.js';
import { idempotentMutation } from '../../shared/idempotency.js';
import { Errors } from '../../shared/errors.js';

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
  const [material, location, actor, recipient] = await Promise.all([
    f.materialId ? prisma.material.findUnique({ where: { id: f.materialId }, select: { sku: true } }) : null,
    f.locationId ? prisma.location.findUnique({ where: { id: f.locationId }, select: { name: true } }) : null,
    f.actorId ? prisma.user.findUnique({ where: { id: f.actorId }, select: { name: true } }) : null,
    f.recipientId && f.recipientId !== '__none__' ? prisma.recipient.findUnique({ where: { id: f.recipientId }, select: { name: true } }) : null,
  ]);
  const writeoffs = f.report === 'writeoffs';
  return [
    f.from || f.to ? `${f.from ?? 'the start'} to ${f.to ?? 'today'}` : 'All dates',
    f.report ? { issued: 'issued stock', transfers: 'transfers', writeoffs: 'write-offs and adjustments', loans: 'tool loans', returned: 'returned stock' }[f.report] : null,
    f.type ? `type ${f.type.replace(/_/g, ' ').toLowerCase()}` : null,
    material ? `item ${material.sku}` : null,
    location ? `at ${location.name}${f.locationIds && f.locationIds.length > 1 ? ' and the locations inside it' : ''}` : null,
    actor ? `by ${actor.name}` : null,
    f.recipientId === '__none__' ? (writeoffs ? 'nobody known responsible' : 'no recipient recorded') : null,
    recipient ? `${writeoffs ? 'responsible' : 'recipient'}: ${recipient.name}` : null,
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
    quantity: storedQuantity,
    // The stock the line takes: the issue's project's own, or null/left out for Stores stock.
    heldForProject: z.string().trim().min(1).max(64).nullable().optional(),
  })).min(1).max(50),
});

export const transferSchema = z.object({
  materialId: uuidSchema,
  fromLocationId: uuidSchema,
  toLocationId: uuidSchema,
  quantity: storedQuantity,
  // Whose stock it takes: the project it is held for, or null/left out for
  // Stores stock (Project Material Through the Store Roadmap, Phase 3).
  heldForProject: z.string().trim().min(1).max(64).nullable().optional(),
});

export const adjustmentSchema = z.object({
  materialId: uuidSchema,
  locationId: uuidSchema,
  quantity: storedSignedQuantity,
  reasonCode: z.enum(['COUNT_VARIANCE', 'DAMAGE', 'LOSS', 'SCRAP', 'OTHER', 'FOUND']),
  reasonNote: z.string().optional(),
  // Who was responsible for damaged, lost or scrapped stock; null or left out when nobody is known.
  recipientId: uuidSchema.nullable().optional(),
  // Whose stock it takes: the project it is held for, or null/left out for
  // Stores stock (Project Material Through the Store Roadmap, Phase 3).
  heldForProject: z.string().trim().min(1).max(64).nullable().optional(),
});

export const adjustmentRequestQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export const adjustmentRejectionSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const stockReceiptSchema = z.object({
  supplierId: supplierIdSchema,
  deliveryRef: z.string().trim().min(1).max(120),
  receivedAt: z.string().optional(),
  lines: z.array(z.object({
    materialId: uuidSchema,
    locationId: uuidSchema,
    quantity: storedQuantity,
  })).min(1).max(50),
});

export const stockCountSchema = z.object({
  locationId: uuidSchema,
  note: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    materialId: uuidSchema,
    // What the system shows, checked against the balance when posting. It can be below
    // zero after a booking mistake, which is what the count is there to correct.
    expectedQuantity: storedSignedQuantity,
    countedQuantity: storedCount,
    note: z.string().trim().max(200).optional(),
  })).min(1).max(2000),
});


export const returnSchema = z.object({
  quantity: storedQuantity,
  locationId: uuidSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * What comes back at the counter, each line against its own issue (POST
 * /inventory-returns): quantity back on the shelf, and for an item that tracks
 * use, usedUp and broken. Each line needs at least one of the three.
 */
export const returnManySchema = z.object({
  lines: z.array(z.object({
    issueTransactionId: z.string().min(1),
    quantity: storedQuantity.optional(),
    usedUp: storedQuantity.optional(),
    broken: storedQuantity.optional(),
    locationId: uuidSchema.optional(),
  }).refine((l) => l.quantity !== undefined || l.usedUp !== undefined || l.broken !== undefined, {
    message: 'Each line needs something coming back: on the shelf, used up or broken',
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

/** Part of an issue of a tracked consumable used up or broken (POST /inventory-transactions/:id/outcomes). */
export const consumableOutcomeSchema = z.object({
  outcome: z.enum(['USED_UP', 'BROKEN']),
  quantity: storedQuantity,
  note: z.string().trim().max(500).optional(),
});

export const outcomeWithdrawalSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

/**
 * With procurement on, every delivery to the store is booked against an
 * approved Stores order (`POST /goods-receipts`), so a receipt with no order
 * is refused. Counter receipts are how stock arrives when procurement is off.
 */
export const COUNTER_RECEIPTS_OFF =
  'Deliveries to the store are booked against an approved Stores order: choose the order on Receive stock.';

export async function inventoryRoutes(app: FastifyInstance, opts: { procurementEnabled?: boolean } = {}): Promise<void> {
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

  // The Write-offs report's totals by who was responsible; the service sets the report itself.
  app.get('/inventory-transactions/writeoffs-by-responsible', { preHandler: [app.authenticate] }, async (req) => {
    return InventoryService.writeoffsByResponsible(await historyFilter(req.query as Record<string, string | undefined>));
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
    const buf = await buildMovementsXlsx(rows, { scope: await describeHistoryFilter(filter), generatedAt: now, report: filter.report });
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
    // Worth more than inventory.writeOffApprovalAbove, it waits for someone
    // else's approval: 202, with nothing posted yet.
    return idempotentMutation(req, reply, 'POST /inventory-adjustments', async (tx) => {
      const outcome = await WriteOffApprovalService.adjustOrRequest({ ...parsed.data, actorId: actorId(req) }, tx);
      return { statusCode: outcome.status === 'POSTED' ? 201 : 202, body: outcome };
    });
  });

  // Adjustments waiting for approval, and those decided. Seen by whoever may
  // ask for one or approve one.
  app.get('/adjustment-requests', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!(await userHasPermission(req, PermissionCode.ApproveWriteOff))) await requirePermission(req, PermissionCode.AdjustInventory);
    const parsed = adjustmentRequestQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status', details: parsed.error.flatten() } });
    }
    return WriteOffApprovalService.list(parsed.data);
  });

  // Posts it. Never by whoever asked for it.
  app.post('/adjustment-requests/:id/approve', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ApproveWriteOff);
    const { id } = req.params as { id: string };
    return idempotentMutation(req, reply, 'POST /adjustment-requests/:id/approve', async (tx) => ({
      statusCode: 201,
      body: await WriteOffApprovalService.approve(id, actorId(req), tx),
    }));
  });

  // Turns it down, posting nothing: someone who approves, or whoever asked for it, withdrawing it.
  app.post('/adjustment-requests/:id/reject', { preHandler: [app.authenticate] }, async (req, reply) => {
    const mayDecide = await userHasPermission(req, PermissionCode.ApproveWriteOff);
    if (!mayDecide) await requirePermission(req, PermissionCode.AdjustInventory);
    const parsed = adjustmentRejectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Say why it is rejected', details: parsed.error.flatten() } });
    }
    const { id } = req.params as { id: string };
    return idempotentMutation(req, reply, 'POST /adjustment-requests/:id/reject', async (tx) => ({
      statusCode: 200,
      body: await WriteOffApprovalService.reject(id, parsed.data.reason, actorId(req), mayDecide, tx),
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
    // receipt=confirmed or unconfirmed: by whether the person collecting confirmed the slip (ADR-034).
    const receipt = (['confirmed', 'unconfirmed'] as const).find((r) => r === q['receipt']);
    return InventoryService.issueSlips({ ...(await historyFilter(q)), receipt, before: q['before'], limit: q['limit'] ? Number(q['limit']) : undefined });
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

  // Counter receipts, with no order: only while procurement is switched off.
  app.post('/stock-receipts', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ReceiveInventory);
    if (opts.procurementEnabled) throw Errors.validation(COUNTER_RECEIPTS_OFF);
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

  // Tracked consumables: what became of an issue line, used up or broken.
  app.get('/inventory-transactions/:id/outcomes', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    return ConsumableOutcomeService.forIssue(id);
  });

  // Same people as issuing and returning: it is booked at the counter.
  app.post('/inventory-transactions/:id/outcomes', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.IssueInventory);
    const parsed = consumableOutcomeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Say whether it was used up or broken, and how many', details: parsed.error.flatten() },
      });
    }
    const { id } = req.params as { id: string };
    return idempotentMutation(req, reply, 'POST /inventory-transactions/:id/outcomes', async (tx) => ({
      statusCode: 201,
      body: await ConsumableOutcomeService.record({ issueTransactionId: id, ...parsed.data, actorId: actorId(req) }, tx),
    }));
  });

  // Withdrawing an outcome recorded by mistake: the same people who reverse movements.
  app.post('/consumable-outcomes/:id/withdrawal', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ReverseInventoryTransaction);
    const parsed = outcomeWithdrawalSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'A reason is required to withdraw it', details: parsed.error.flatten() },
      });
    }
    const { id } = req.params as { id: string };
    return idempotentMutation(req, reply, 'POST /consumable-outcomes/:id/withdrawal', async (tx) => ({
      statusCode: 201,
      body: await ConsumableOutcomeService.withdraw({ outcomeId: id, reason: parsed.data.reason, actorId: actorId(req) }, tx),
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