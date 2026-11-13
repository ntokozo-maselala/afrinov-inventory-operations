import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RecipientService, RECIPIENT_TYPES } from './recipient.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import { PIN_PATTERN } from './recipient-pin.js';
import { selfIssuedSlips } from './self-issue.js';

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
  /** The person's user account (system audit F5). */
  userId: z.uuid().optional(),
});

export const updateRecipientSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: recipientTypeEnum.optional(),
  notes: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  userId: z.uuid().nullable().optional(),
});

export const setPinSchema = z.object({
  pin: z.string().regex(PIN_PATTERN),
});

export const resetPinSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

export async function recipientRoutes(app: FastifyInstance): Promise<void> {
  // Slips someone issued or lent to themselves in the last 30 days (system
  // audit F5), for the Dashboard: for those who read Activity.
  app.get('/reports/self-issued', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewAuditLog);
    return selfIssuedSlips();
  });

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

  // Counter PINs (ADR-034). A store controller starts each of these; the PIN
  // itself is typed by the person it belongs to.
  app.put('/recipients/:id/pin', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageRecipients);
    const parsed = setPinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'A PIN is 4 to 6 digits', details: parsed.error.flatten() },
      });
    }
    return RecipientService.setPin((req.params as { id: string }).id, parsed.data.pin, actorId(req));
  });

  app.post('/recipients/:id/pin/reset', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageRecipients);
    const parsed = resetPinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Say why the PIN is reset', details: parsed.error.flatten() },
      });
    }
    return RecipientService.resetPin((req.params as { id: string }).id, parsed.data.reason, actorId(req));
  });

  app.post('/recipients/:id/pin/unlock', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageRecipients);
    return RecipientService.unlockPin((req.params as { id: string }).id, actorId(req));
  });
}
