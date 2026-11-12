import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../shared/authorization.js';
import { PermissionCode } from '../../shared/permissions.js';
import { BackupStatusService } from './backup-status.js';

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  // ADR-037: whether backups ran, left the server and were restored lately.
  // For whoever keeps the system running: those who change its settings.
  app.get('/backups/status', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ManageSettings);
    return BackupStatusService.health();
  });
}
