import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from './identity.service.js';
import { newPasswordSchema } from './password-policy.js';
import { loadAccountState } from '../../shared/authorization.js';

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).regex(/[^\0]/),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1000),
  newPassword: newPasswordSchema,
});

type TokenUser = { sub: string; email: string; name: string; roles: string[] };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid login payload', details: parsed.error.flatten() },
      });
    }
    const user = await AuthService.login(parsed.data.email, parsed.data.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const token = app.jwt.sign({ sub: user.id, email: user.email, name: user.name, roles: user.roles });
    return reply.send({ token, user });
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    const u = (req as unknown as { user: TokenUser }).user;
    const state = await loadAccountState(u.sub, req);
    return { id: u.sub, email: u.email, name: u.name, roles: u.roles, mustChangePassword: state?.mustChangePassword ?? false };
  });

  // A user replaces their own password. Every token issued before the change
  // is refused from now on, so the caller gets a fresh one and stays signed in.
  app.post('/auth/password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'The new password does not meet the rules', details: parsed.error.flatten() },
      });
    }
    const u = (req as unknown as { user: TokenUser }).user;
    await AuthService.changePassword(u.sub, parsed.data.currentPassword, parsed.data.newPassword);
    const token = app.jwt.sign({ sub: u.sub, email: u.email, name: u.name, roles: u.roles });
    return reply.send({ token, user: { id: u.sub, email: u.email, name: u.name, roles: u.roles, mustChangePassword: false } });
  });
}
