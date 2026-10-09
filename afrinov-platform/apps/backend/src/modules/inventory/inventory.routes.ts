import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supplierIdSchema } from '../../shared/ids.js';
import { InventoryService } from './inventory.service.js';
import { StockReceiptService } from './stock-receipt.service.js';
import { StockCountService } from './stock-count.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

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
    expectedQuantity: z.number(),
    countedQuantity: z.number().min(0),
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

/** Register authenticated inventory endpoints with payload validation and mutation permission checks. */
export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/inventory-transactions', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return InventoryService.queryHistory({
      materialId: q['materialId'],
      type: q['type'],
      from: q['from'],
      to: q['to'],
      projectNumber: q['projectNumber'],
      limit: q['limit'] ? Number(q['limit']) : undefined,
    });
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
