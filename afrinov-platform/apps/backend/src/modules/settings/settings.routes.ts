import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SettingsService, isAdmin } from './settings.service.js';
import { requirePermission } from '../../shared/authorization.js';
import { PermissionCode } from '../../shared/permissions.js';
import { Errors } from '../../shared/errors.js';

const setOneSchema = z.object({ value: z.unknown() });

const setManySchema = z.object({
  updates: z.record(z.string().min(1), z.unknown()),
});

function roles(req: FastifyRequest): string[] {
  const u = (req as { user?: { roles?: string[]; sub?: string; email?: string; name?: string } }).user;
  if (u && Array.isArray((u as { roles?: string[] }).roles)) {
    return (u as { roles: string[] }).roles;
  }
  return [];
}

function actorId(req: FastifyRequest): string {
  return (req as unknown as { user: { id: string } }).user.id;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // Reading settings: any authenticated user may read (they need it for
  // theme/density application, low-stock indicators, etc.).
  app.get('/settings', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as { category?: string } | undefined;
    return SettingsService.list(q?.category ? { category: q.category as never } : undefined);
  });

  app.get('/settings/values', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as { keys?: string } | undefined;
    if (!q?.keys) return {};
    const keys = q.keys.split(',').map((k) => k.trim()).filter(Boolean);
    return SettingsService.getValues(keys);
  });

  app.get('/settings/:key', { preHandler: [app.authenticate] }, async (req) => {
    const key = (req.params as { key: string }).key;
    return SettingsService.get(key);
  });

  // Mutations: require administrative settings permission. The route layer
  // does a fast admin check before the heavier permission lookup so a
  // non-admin gets a 403 even when the user has no role grants at all.
   app.put('/settings/:key', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!isAdmin(roles(req))) throw Errors.forbidden('Only administrators can modify settings');
    await requirePermission(req, PermissionCode.ManageSettings);
    const key = (req.params as { key: string }).key;
    const parsed = setOneSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parsed.error.flatten() } });
    }
    return SettingsService.set(key, parsed.data.value, actorId(req));
  });

  app.patch('/settings', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!isAdmin(roles(req))) throw Errors.forbidden('Only administrators can modify settings');
    await requirePermission(req, PermissionCode.ManageSettings);
    const parsed = setManySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parsed.error.flatten() } });
    }
    return SettingsService.setMany(parsed.data.updates, actorId(req));
  });

  app.post('/settings/reset', { preHandler: [app.authenticate] }, async (req) => {
    if (!isAdmin(roles(req))) throw Errors.forbidden('Only administrators can reset settings');
    await requirePermission(req, PermissionCode.ManageSettings);
    return SettingsService.resetDefaults(actorId(req));
  });
}
