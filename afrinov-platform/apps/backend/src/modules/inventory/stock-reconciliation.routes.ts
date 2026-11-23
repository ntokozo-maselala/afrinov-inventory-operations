import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../shared/authorization.js';
import { PermissionCode } from '../../shared/permissions.js';
import { StockReconciliationService } from './stock-reconciliation.js';

export async function stockReconciliationRoutes(app: FastifyInstance): Promise<void> {
  // ADR-047: whether the daily check found the stock figures adding up. For
  // whoever keeps the system running, as backups are: those who change its settings.
  app.get('/stock-reconciliation/status', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSettings);
    return StockReconciliationService.health();
  });
}
