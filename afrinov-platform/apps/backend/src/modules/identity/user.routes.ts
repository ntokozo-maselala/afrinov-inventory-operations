import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserService } from './identity.service.js';
import { PermissionCode } from '../../shared/permissions.js';
import { requirePermission } from '../../shared/authorization.js';
import { newPasswordSchema } from './auth.routes.js';

const ROLE_NAMES = ['ADMIN', 'STORE_CONTROLLER', 'PROCUREMENT', 'APPROVER', 'TECHNICIAN', 'VIEWER', 'PROCUREMENT_MANAGER', 'DIRECTOR', 'CEO', 'WORKSHOP_MANAGER', 'SALES'] as const;

export const createUserSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  password: newPasswordSchema,
  roleNames: z.array(z.enum(ROLE_NAMES)).min(1),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  roleNames: z.array(z.enum(ROLE_NAMES)).min(1).optional(),
});

export const temporaryPasswordSchema = z.object({ temporaryPassword: newPasswordSchema });

function actorId(req: unknown): string {
  return (req as { user: { id: string } }).user.id;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageUsers);
    return UserService.list();
  });

  app.get('/users/lookup', { preHandler: [app.authenticate] }, async (req) => {
    // Read-only id/name list of active users, used by the issue form
    // (recipient selection) and the transaction drawer (actor
    // reassignment). Requires the dedicated read permission — not the
    // write permission it previously (mis)used (K10).
    await requirePermission(req, PermissionCode.ViewUsers);
    return UserService.listForLookup();
  });

  app.get('/users/:id', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageUsers);
    const id = (req.params as { id: string }).id;
    return UserService.getById(id);
  });

  app.post('/users', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageUsers);
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid user payload', details: parsed.error.flatten() },
      });
    }
    const created = await UserService.create(parsed.data, actorId(req));
    return reply.code(201).send(created);
  });

  app.patch('/users/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageUsers);
    const id = (req.params as { id: string }).id;
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid user payload', details: parsed.error.flatten() },
      });
    }
    const updated = await UserService.update({ id, ...parsed.data }, actorId(req));
    return updated;
  });

  // ADR-036: an Admin gives someone a temporary password, to be changed at their next sign-in.
  app.post('/users/:id/password', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ManageUsers);
    const id = (req.params as { id: string }).id;
    const parsed = temporaryPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'A temporary password needs at least 8 characters', details: parsed.error.flatten() },
      });
    }
    return UserService.setTemporaryPassword(id, parsed.data.temporaryPassword, actorId(req));
  });
}
