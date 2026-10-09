import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { Errors } from '../../shared/errors.js';
import { PermissionCode } from '../../shared/permissions.js';

const mocks = vi.hoisted(() => ({ report: vi.fn(), workbook: vi.fn(), permissions: [] as string[] }));
vi.mock('../../shared/db.js', () => ({ prisma: {
  user: { findUnique: async () => ({ active: true }) },
  userRole: { findMany: async () => [{ role: { permissions: mocks.permissions.map((code) => ({ permission: { code } })) } }] },
} }));
vi.mock('./month-end.service.js', () => ({ MonthEndService: { report: mocks.report } }));
vi.mock('./month-end-export.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./month-end-export.js')>(), buildMonthEndXlsx: mocks.workbook,
}));

describe('month-end routes', () => {
  let app: FastifyInstance;
  const report = { month: '2026-09', categories: [], total: { items: 0 } };
  const bytes = Buffer.from('test workbook bytes');
  const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ sub: 'report-reader', email: 'reader@example.test', name: 'Reader', roles: [] })}` });

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.permissions = [PermissionCode.ViewReports];
    mocks.report.mockResolvedValue(report);
    mocks.workbook.mockResolvedValue(bytes);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
    app = await buildServer({ skipConfigValidation: true });
  });
  afterEach(async () => {
    await app?.close();
    vi.useRealTimers();
  });

  describe.each(['/reports/month-end', '/reports/month-end/export'])('%s', (path) => {
    it('requires authentication before computing the report', async () => {
      const response = await app.inject({ method: 'GET', url: `/api/v1${path}?month=2026-09` });
      expect(response.statusCode).toBe(401);
      expect(mocks.report).not.toHaveBeenCalled();
      expect(mocks.workbook).not.toHaveBeenCalled();
    });

    it('requires view:reports permission', async () => {
      mocks.permissions = [];
      const response = await app.inject({ method: 'GET', url: `/api/v1${path}?month=2026-09`, headers: headers() });
      expect(response.statusCode).toBe(403);
      expect(mocks.report).not.toHaveBeenCalled();
      expect(mocks.workbook).not.toHaveBeenCalled();
    });

    it.each(['', '?month='])('defaults to the current UTC month for %j', async (query) => {
      const response = await app.inject({ method: 'GET', url: `/api/v1${path}${query}`, headers: headers() });
      expect(response.statusCode).toBe(200);
      expect(mocks.report).toHaveBeenCalledExactlyOnceWith('2026-10');
    });

    it('returns a service validation error without building a file', async () => {
      mocks.report.mockRejectedValue(Errors.validation('That month has not started yet'));
      const response = await app.inject({ method: 'GET', url: `/api/v1${path}?month=2999-01`, headers: headers() });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'That month has not started yet' });
      expect(mocks.workbook).not.toHaveBeenCalled();
    });
  });

  it('returns the selected month report unchanged', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/reports/month-end?month=2026-09', headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(report);
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith('2026-09');
    expect(mocks.workbook).not.toHaveBeenCalled();
  });

  it('exports the report bytes with download headers and caching disabled', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/reports/month-end/export?month=2026-09', headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith('2026-09');
    expect(mocks.workbook).toHaveBeenCalledExactlyOnceWith(report);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers).toMatchObject({
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="afrinov-month-end-2026-09.xlsx"',
      'content-length': String(bytes.length), 'cache-control': 'no-store',
    });
  });

  it('returns an error if workbook generation fails', async () => {
    mocks.workbook.mockRejectedValue(new Error('Workbook generation failed'));
    const response = await app.inject({ method: 'GET', url: '/api/v1/reports/month-end/export?month=2026-09', headers: headers() });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-disposition']).toBeUndefined();
  });
});
