import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from './identity.service.js';
import { loadUserPermissions } from '../../shared/authorization.js';
import { Errors } from '../../shared/errors.js';
import { issueSessionToken } from './session.js';
import { authTimeOf } from './session-policy.js';

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).regex(/[^\0]/),
});

/** A password someone chooses: at least 8 characters (ADR-036). */
export const newPasswordSchema = z.string().min(8, 'Use at least 8 characters.').max(128, 'Use at most 128 characters.').regex(/[^\0]/);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).regex(/[^\0]/),
  newPassword: newPasswordSchema,
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid login payload', details: parsed.error.flatten() },
      });
    }
    const user = await AuthService.login(parsed.data.email, parsed.data.password);
    // A new sign-in always has its 12 hours ahead of it.
    const token = await issueSessionToken(app, user);
    if (!token) throw new Error('A new sign-in was refused a token');
    return reply.send({ token, user });
  });

  // ADR-035: the screen renews its token while the person is active, so the
  // idle time counts from their last activity. Renewal keeps when the sign-in
  // began and stops 12 hours after it; the account is read again, so a
  // deactivation or a change of role takes effect here too.
  app.post('/auth/refresh', { preHandler: [app.authenticate] }, async (req, reply) => {
    const claims = req.user as { sub: string; iat?: unknown; auth_time?: unknown };
    const authTime = authTimeOf(claims);
    const user = await AuthService.sessionUser(claims.sub);
    if (authTime === null || !user) throw Errors.unauthenticated();
    const token = await issueSessionToken(app, user, authTime);
    if (!token) throw Errors.unauthenticated('Your sign-in has ended. Sign in again.');
    return reply.send({ token, user });
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    const u = (req as unknown as { user: { sub: string; email: string; name: string; roles: string[]; mustChangePassword?: boolean } }).user;
    // Permissions are read now, not from the token, so a changed grant shows on the next load.
    const permissions = [...(await loadUserPermissions(u.sub, req))].sort();
    return { id: u.sub, email: u.email, name: u.name, roles: u.roles, permissions, mustChangePassword: u.mustChangePassword === true };
  });

  // ADR-036: a person changes their own password. Every other sign-in ends;
  // this one carries on with a fresh token, as a new sign-in would.
  app.post('/auth/password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Enter your current password and a new one of at least 8 characters', details: parsed.error.flatten() },
      });
    }
    const { sub } = req.user as { sub: string };
    const user = await AuthService.changePassword(sub, parsed.data.currentPassword, parsed.data.newPassword);
    const token = await issueSessionToken(app, user);
    if (!token) throw new Error('A changed password was refused a token');
    return reply.send({ token, user });
  });
}
