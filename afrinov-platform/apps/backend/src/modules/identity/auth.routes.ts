import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from './identity.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { Errors } from '../../shared/errors.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
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
    const token = app.jwt.sign({ sub: user.id, email: user.email, name: user.name, roles: user.roles });
    return reply.send({ token, user });
  });

  // Self-registration (ADR-005). Unauthenticated by design, and
  // rate-limited via the STRICT_AUTH_PATHS list in server.ts. The
  // capability is fail-closed: unless an operator has enabled
  // `security.allowSelfRegistration`, the route refuses with
  // 403 REGISTRATION_DISABLED. New accounts get the VIEWER role
  // only — elevation is an administrator action.
  app.post('/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid registration payload', details: parsed.error.flatten() },
      });
    }
    const allowed = await SettingsService.getValue<boolean>('security.allowSelfRegistration');
    if (!allowed) {
      throw Errors.registrationDisabled();
    }
    const user = await AuthService.register(parsed.data, 'self-registration');
    return reply.code(201).send({ user });
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    const u = (req as unknown as { user: { sub: string; email: string; name: string; roles: string[] } }).user;
    return { id: u.sub, email: u.email, name: u.name, roles: u.roles };
  });
}