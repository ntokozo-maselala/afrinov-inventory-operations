import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RackService } from './rack.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

const rackStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'FULL']);

export const createRackSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  locationId: z.string().uuid().optional(),
  projectNumber: z.string().min(1).max(64).optional(),
  capacity: z.number().int().nonnegative().optional(),
  status: rackStatusEnum.optional(),
  notes: z.string().max(1000).optional(),
});

export const updateRackSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  projectNumber: z.string().min(1).max(64).nullable().optional(),
  capacity: z.number().int().nonnegative().nullable().optional(),
  status: rackStatusEnum.optional(),
  notes: z.string().max(1000).nullable().optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

export async function rackRoutes(app: FastifyInstance): Promise<void> {
  app.get('/racks', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return RackService.list({
      q: q['q'],
      locationId: q['locationId'],
      projectNumber: q['projectNumber'],
      status: q['status'] as 'ACTIVE' | 'INACTIVE' | 'FULL' | undefined,
    });
  });

  app.get('/racks/:id', { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    return RackService.getById(id);
  });

  app.post('/racks', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageRacks);
    const parsed = createRackSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid rack payload', details: parsed.error.flatten() },
      });
    }
    const created = await RackService.create(parsed.data, actorId(req));
    return reply.code(201).send(created);
  });

  app.patch('/racks/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageRacks);
    const id = (req.params as { id: string }).id;
    const parsed = updateRackSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid rack payload', details: parsed.error.flatten() },
      });
    }
    return RackService.update({ id, ...parsed.data }, actorId(req));
  });

  app.delete('/racks/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageRacks);
    const id = (req.params as { id: string }).id;
    const archived = await RackService.archive(id, actorId(req));
    return reply.send(archived);
  });
}