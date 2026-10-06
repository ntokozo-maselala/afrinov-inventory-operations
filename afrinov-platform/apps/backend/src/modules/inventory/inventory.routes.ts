import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InventoryService } from './inventory.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

const issueSchema = z.object({
  materialId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number().positive(),
  recipientId: z.string().uuid().optional(),
  projectNumber: z.string().optional(),
});

const transferSchema = z.object({
  materialId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantity: z.number().positive(),
});

const adjustmentSchema = z.object({
  materialId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number(),
  reasonCode: z.enum(['COUNT_VARIANCE', 'DAMAGE', 'LOSS', 'SCRAP', 'OTHER']),
  reasonNote: z.string().optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

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

  app.patch('/inventory-transactions/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.UpdateInventoryTransaction);
    const id = (req.params as { id: string }).id;
    const body = req.body as { actorId?: string } | undefined;
    if (!body?.actorId || typeof body.actorId !== 'string') {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Please select a valid issuing person.' },
      });
    }
    try {
      const result = await InventoryService.updateActor({
        transactionId: id,
        newActorId: body.actorId,
        changedBy: actorId(req),
      });
      return result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'The inventory transaction could not be found.' },
        });
      }
      throw err;
    }
  });
}