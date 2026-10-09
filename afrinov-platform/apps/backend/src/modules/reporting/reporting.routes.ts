import type { FastifyInstance } from 'fastify';
import { ReportingService } from './reporting.service.js';
import { ReportService } from './report.service.js';
import { parseReportQuery } from './report-query.schema.js';
import { buildInventoryPdf, buildInventoryXlsx } from './report-export.js';
import { buildReorderXlsx, reorderFilename } from './reorder-export.js';
import { getStatusBands } from '../../shared/inventory/stock-status.js';
import { SettingsService } from '../settings/settings.service.js';
import { requirePermission } from '../../shared/authorization.js';
import { PermissionCode } from '../../shared/permissions.js';
import { Errors } from '../../shared/errors.js';

function exportFilename(rangeLabel: string, generatedAt: string, extension: 'xlsx' | 'pdf'): string {
  const range = rangeLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all-time';
  const date = new Date(generatedAt).toISOString().slice(0, 10);
  return `afrinov-inventory-report-${range}-${date}.${extension}`;
}

export async function reportingRoutes(app: FastifyInstance): Promise<void> {
  // ── Existing per-resource reads (kept for the dashboard / low-stock page)
  app.get('/reports/current-stock', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    return ReportingService.currentStock({
      category: q['category'],
      locationId: q['locationId'],
      materialId: q['materialId'],
    });
  });

  app.get('/reports/movement-history', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    return ReportingService.movementHistory({
      materialId: q['materialId'],
      type: q['type'],
      from: q['from'],
      to: q['to'],
      projectNumber: q['projectNumber'],
      limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  app.get('/reports/stock-status', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    const status = (q['status'] ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    const allowed = ['URGENT', 'WARNING', 'OK', 'NOT_SET'];
    if (status.some((x) => !allowed.includes(x))) throw Errors.validation(`status must be one or more of ${allowed.join(', ')}`);
    return ReportingService.stockStatus({ status: status as Array<'URGENT' | 'WARNING' | 'OK' | 'NOT_SET'>, category: q['category'] });
  });

  // The items to re-order (URGENT and WARNING) as an Excel file for the buyer.
  app.get('/reports/reorder-list/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    const [rows, bands, currency] = await Promise.all([
      ReportingService.stockStatus({ status: ['URGENT', 'WARNING'], category: q['category'] }),
      getStatusBands(),
      SettingsService.getValue<string>('general.defaultCurrency'),
    ]);
    const generatedAt = new Date();
    const buf = await buildReorderXlsx(rows, { generatedAt, bands, currency });
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${reorderFilename(generatedAt)}"`)
      .header('Content-Length', String(buf.length))
      .header('Cache-Control', 'no-store')
      .send(buf);
  });

  app.get('/reports/low-stock', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    return ReportingService.lowStock();
  });

  app.get('/reports/project-consumption/:projectNumber', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const projectNumber = (req.params as { projectNumber: string }).projectNumber;
    return ReportingService.projectConsumption(projectNumber);
  });

  // ── New: consolidated inventory report ──────────────────────────────────
  // The single source of truth for the /reports/inventory page. The frontend
  // and the export endpoints consume the same object, so a user viewing the
  // page and a user downloading the file see the same data.
  app.get('/reports/inventory', { preHandler: [app.authenticate] }, async (req) => {
    await requirePermission(req, PermissionCode.ViewReports);
    let query;
    try {
      query = parseReportQuery(req.query);
    } catch (err) {
      throw Errors.validation('Invalid report query', { issues: (err as Error).message });
    }
    return ReportService.inventory(query);
  });

  // XLSX export — the same `ReportService.inventory(...)` result is rendered
  // into a workbook. No second source of truth.
  app.get('/reports/inventory/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    await requirePermission(req, PermissionCode.ViewReports);
    const q = req.query as Record<string, string | undefined>;
    const format = (q['format'] ?? 'xlsx').toLowerCase();
    if (format !== 'xlsx' && format !== 'pdf') {
      throw Errors.validation('Unsupported export format', { format });
    }
    let query;
    try {
      query = parseReportQuery(req.query);
    } catch (err) {
      throw Errors.validation('Invalid report query', { issues: (err as Error).message });
    }
    try {
      const report = await ReportService.inventory(query);
      if (format === 'xlsx') {
        const buf = await buildInventoryXlsx(report);
        return reply
          .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="${exportFilename(report.kpis.rangeLabel, report.generatedAt, 'xlsx')}"`)
          .header('Content-Length', String(buf.length))
          .header('Cache-Control', 'no-store')
          .send(buf);
      }

      const buf = await buildInventoryPdf(report);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${exportFilename(report.kpis.rangeLabel, report.generatedAt, 'pdf')}"`)
        .header('Content-Length', String(buf.length))
        .header('Cache-Control', 'no-store')
        .send(buf);
    } catch (err) {
      req.log.error({ err, format }, 'Inventory report export failed');
      throw err;
    }
  });
}
