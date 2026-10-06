// Audit log read endpoint.
//
// Restricted to ADMIN by default. The view:audit_log permission grants
// non-admin access where appropriate.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { requirePermission } from '../../shared/authorization.js';
import { PermissionCode } from '../../shared/permissions.js';

const querySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audit', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      await requirePermission(req, PermissionCode.ViewAuditLog);
    } catch {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to view the audit log.' } });
    }
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
    }
    const where: { entityType?: string; entityId?: string } = {};
    if (parsed.data.entityType) where.entityType = parsed.data.entityType;
    if (parsed.data.entityId) where.entityId = parsed.data.entityId;
    const rows = await prisma.auditLogEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit,
    });
    return rows;
  });
}
