import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RecipientService, RECIPIENT_TYPES } from './recipient.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';

const recipientTypeEnum = z.enum(RECIPIENT_TYPES as ['WORKER', 'MACHINE', 'SITE', 'CONTRACTOR']);

export const listRecipientsQuerySchema = z.object({
  q: z.string().max(120).optional(),
  type: recipientTypeEnum.optional(),
  active: z.enum(['true', 'false']).optional(),
});

export const createRecipientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: recipientTypeEnum,
  notes: z.string().max(1000).optional(),
});

export const updateRecipientSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: recipientTypeEnum.optional(),
  notes: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

export async function recipientRoutes(app: FastifyInstance): Promise<void> {
  // Any signed-in user can read the list: it fills the "Issued To" dropdown.
  app.get('/recipients', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = listRecipientsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid recipient filter', details: parsed.error.flatten() },
      });
    }
    const { q, type, active } = parsed.data;
    return RecipientService.list({ q, type, active: active === undefined ? undefined : active === 'true' });
  });

  app.get('/recipients/:id', { preHandler: [app.authenticate] }, async (req) => {
    return RecipientService.getById((req.params as { id: string }).id);
  });

  app.post('/recipients', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageRecipients);
    const parsed = createRecipientSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid recipient payload', details: parsed.error.flatten() },
      });
    }
    const created = await RecipientService.create(parsed.data, actorId(req));
    return reply.code(201).send(created);
  });

  app.patch('/recipients/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageRecipients);
    const parsed = updateRecipientSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid recipient payload', details: parsed.error.flatten() },
      });
    }
    return RecipientService.update({ id: (req.params as { id: string }).id, ...parsed.data }, actorId(req));
  });
}
