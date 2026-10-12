// Audit log read endpoints: the raw log (/audit) and the described activity
// list the Movements page shows (/activity).
//
// Both need the view:audit_log permission: Admin and Store Controller.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { requirePermission } from '../../shared/authorization.js';
import { PermissionCode } from '../../shared/permissions.js';
import { ActivityService } from './activity.service.js';

export const auditQuerySchema = z.object({
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
    const parsed = auditQuerySchema.safeParse(req.query);
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

  // The shop's other activity for the Movements page: described, filtered and paged.
  app.get('/activity', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewAuditLog);
    const q = req.query as Record<string, string | undefined>;
    return ActivityService.list({
      from: q['from'], to: q['to'], entityType: q['entityType'], actorId: q['actorId'], locationId: q['locationId'],
      before: q['before'], limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  app.get('/activity/actors', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewAuditLog);
    return ActivityService.actors();
  });
}
