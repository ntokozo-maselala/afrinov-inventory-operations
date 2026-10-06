// Health probes mounted under the /api/v1 prefix (K5).
//
// The root-level `/health` and `/health/ready` probes in
// server.ts answer infrastructure questions (is the process
// alive? can it reach the database?). The frontend's Settings →
// System page calls `/api/v1/health` through the shared API
// client, which prefixes every request with `/api/v1` — so the
// same probes must also exist under the prefix, otherwise the
// UI permanently misreports a running API as offline.
//
// These handlers are intentionally unauthenticated and
// read-only: they disclose only liveness/readiness state, and
// rate limiting applies globally.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../../shared/db.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: is the process alive?
  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  // Readiness: does the database connection pool have a live
  // connection? A 503 here must never be masked as a 200 —
  // operators act on this signal.
  app.get('/health/ready', async (req, reply: FastifyReply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: 'ready', database: 'connected', time: new Date().toISOString() });
    } catch (err) {
      req.log.error({ err }, 'Readiness check failed');
      return reply.code(503).send({ status: 'not_ready', database: 'error', time: new Date().toISOString() });
    }
  });
}
