import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supplierIdSchema } from '../../shared/ids.js';
import { InventoryService, type HistoryFilter } from './inventory.service.js';
import { buildMovementsXlsx, movementsFilename, MOVEMENTS_EXPORT_LIMIT } from './movements-export.js';
import { prisma } from '../../shared/db.js';
import { StockReceiptService } from './stock-receipt.service.js';
import { StockCountService } from './stock-count.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

/** The history filters a query string carries; shared by the list, its totals and the download. */
function historyFilter(q: Record<string, string | undefined>): Omit<HistoryFilter, 'before' | 'limit'> {
  return {
    materialId: q['materialId'],
    type: q['type'],
    from: q['from'],
    to: q['to'],
    projectNumber: q['projectNumber'],
    locationId: q['locationId'],
    actorId: q['actorId'],
    recipientId: q['recipientId'],
    q: q['q'],
    report: (['issued', 'transfers', 'writeoffs'] as const).find((r) => r === q['report']),
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
    f.report ? { issued: 'issued stock', transfers: 'transfers', writeoffs: 'write-offs and adjustments' }[f.report] : null,
    f.type ? `type ${f.type.replace(/_/g, ' ').toLowerCase()}` : null,
    material ? `item ${material.sku}` : null,
    location ? `at ${location.name}` : null,
    actor ? `by ${actor.name}` : null,
    f.projectNumber ? `project ${f.projectNumber}` : null,
    f.q?.trim() ? `matching "${f.q.trim()}"` : null,
  ].filter(Boolean).join(', ');
}

export const issueSchema = z.object({
  recipientId: z.string().uuid(),
  projectNumber: z.string().trim().min(1).max(64).optional(),
  lines: z.array(z.object({
    materialId: z.string().uuid(),
    locationId: z.string().uuid(),
    quantity: z.number().positive(),
  })).min(1).max(50),
});

export const transferSchema = z.object({
  materialId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantity: z.number().positive(),
});

export const adjustmentSchema = z.object({
  materialId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number(),
  reasonCode: z.enum(['COUNT_VARIANCE', 'DAMAGE', 'LOSS', 'SCRAP', 'OTHER']),
  reasonNote: z.string().optional(),
});

export const stockReceiptSchema = z.object({
  supplierId: supplierIdSchema,
  deliveryRef: z.string().trim().min(1).max(120),
  receivedAt: z.string().optional(),
  lines: z.array(z.object({
    materialId: z.string().uuid(),
    locationId: z.string().uuid(),
    quantity: z.number().positive(),
  })).min(1).max(50),
});

export const stockCountSchema = z.object({
  locationId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    materialId: z.string().uuid(),
    expectedQuantity: z.number().min(0),
    countedQuantity: z.number().min(0),
    note: z.string().trim().max(200).optional(),
  })).min(1).max(2000),
});

export const returnSchema = z.object({
  quantity: z.number().positive(),
  locationId: z.string().uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const reversalSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/inventory-transactions', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return InventoryService.queryHistory({
      ...historyFilter(q),
      before: q['before'],
      limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  app.get('/inventory-transactions/summary', { preHandler: [app.authenticate] }, async (req) => {
    return InventoryService.historySummary(historyFilter(req.query as Record<string, string | undefined>));
  });

  app.get('/inventory-transactions/actors', { preHandler: [app.authenticate] }, async () => {
    return InventoryService.historyActors();
  });

  app.get('/inventory-transactions/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    const filter = historyFilter(req.query as Record<string, string | undefined>);
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
    const result = await InventoryService.issue({ ...parsed.data, actorId: actorId(req) });
    return reply.code(201).send(result);
  });

  app.post('/inventory-transfers', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.TransferInventory);
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid transfer payload', details: parsed.error.flatten() },
      });
    }
    const result = await InventoryService.transfer({ ...parsed.data, actorId: actorId(req) });
    return reply.code(201).send(result);
  });

  app.post('/inventory-adjustments', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.AdjustInventory);
    const parsed = adjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid adjustment payload', details: parsed.error.flatten() },
      });
    }
    const result = await InventoryService.adjust({ ...parsed.data, actorId: actorId(req) });
    return reply.code(201).send(result);
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
    const result = await StockCountService.post({ ...parsed.data, actorId: actorId(req) });
    return reply.code(201).send(result);
  });

  // The issued-stock report: issue slips with their lines, newest first.
  app.get('/inventory-issues', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    return InventoryService.issueSlips({ ...historyFilter(q), before: q['before'], limit: q['limit'] ? Number(q['limit']) : undefined });
  });

  // The received-stock report: deliveries with their lines, newest first.
  app.get('/stock-receipts', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    return StockReceiptService.list({
      from: q['from'], to: q['to'], supplierId: q['supplierId'], locationId: q['locationId'], q: q['q'],
      before: q['before'], limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  // The stock-counts report: each count with its differences, newest first.
  app.get('/stock-counts', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    return StockCountService.list({
      from: q['from'], to: q['to'], locationId: q['locationId'], actorId: q['actorId'],
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
    const result = await StockReceiptService.receive({ ...parsed.data, actorId: actorId(req) });
    return reply.code(201).send(result);
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
    const result = await InventoryService.returnToStock({ issueTransactionId: id, ...parsed.data, actorId: actorId(req) });
    return reply.code(201).send(result);
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
    const result = await InventoryService.reverse({ transactionId: id, reason: parsed.data.reason, actorId: actorId(req) });
    return reply.code(201).send(result);
  });
}