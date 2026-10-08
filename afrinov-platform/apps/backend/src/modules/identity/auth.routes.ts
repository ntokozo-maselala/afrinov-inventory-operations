import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from './identity.service.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    const u = (req as unknown as { user: { sub: string; email: string; name: string; roles: string[] } }).user;
    return { id: u.sub, email: u.email, name: u.name, roles: u.roles };
  });
}