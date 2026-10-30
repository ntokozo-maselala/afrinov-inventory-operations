// Audit log read endpoints: the raw log (/audit) and the described activity
// list the Movements page shows (/activity).
//
// Both need the view:audit_log permission: Admin and Store Controller.
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../shared/db.js';
import { requirePermission, userHasPermission } from '../../shared/authorization.js';
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
    const conditions: Prisma.Sql[] = [];
    if (parsed.data.entityType) conditions.push(Prisma.sql`a.entity_type = ${parsed.data.entityType}`);
    if (parsed.data.entityId) conditions.push(Prisma.sql`a.entity_id = ${parsed.data.entityId}`);
    // The Activity of orders and RFQs follows who may see them (Stores and
    // Procurement Separation Roadmap): Stores orders' to the store, project
    // orders' and RFQs' to Procurement and approvers; Admin sees both, and
    // someone who sees neither kind sees no order's. Each entry is checked
    // against its order in this same query, so the answer is one consistent
    // read and the work follows the page asked for (Qodo, PR #122).
    const seesStores = await userHasPermission(req, PermissionCode.OrderStoresStock);
    const seesProjects = await userHasPermission(req, PermissionCode.ViewPurchaseOrder);
    if (!seesProjects) conditions.push(Prisma.sql`a.entity_type <> 'Rfq'`);
    if (!seesStores && !seesProjects) {
      conditions.push(Prisma.sql`a.entity_type <> 'PurchaseOrder'`);
    } else if (!seesStores || !seesProjects) {
      // The kind this person can't see: Stores orders have no project.
      const unseen = seesProjects ? Prisma.sql`po.project_number IS NULL` : Prisma.sql`po.project_number IS NOT NULL`;
      conditions.push(Prisma.sql`NOT (a.entity_type = 'PurchaseOrder' AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = a.entity_id AND ${unseen}))`);
    }
    const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    return prisma.$queryRaw<Array<{ id: string; actorId: string | null; action: string; entityType: string; entityId: string; before: unknown; after: unknown; createdAt: Date }>>`
      SELECT a.id, a.actor_id AS "actorId", a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
             a."before", a."after", a.created_at AS "createdAt"
      FROM audit_log_entries a
      ${where}
      ORDER BY a.created_at DESC
      LIMIT ${parsed.data.limit}`;
  });

  // The shop's other activity for the Movements page: described, filtered and paged.
  app.get('/activity', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewAuditLog);
    const q = req.query as Record<string, string | undefined>;
    return ActivityService.list({
      from: q['from'], to: q['to'], entityType: q['entityType'], actorId: q['actorId'],
      before: q['before'], limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  app.get('/activity/actors', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewAuditLog);
    return ActivityService.actors();
  });
}
