// HTTP tests for GET /audit, the raw audit log (TD-023): who may read it, what
// each reader is shown of orders and RFQs, and that filters reach the query as
// bound values, never as SQL text.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { buildServer } from '../../server.js';
import { PermissionCode as P, RolePermissions } from '../../shared/permissions.js';

const userPermissions = new Map<string, string[]>();
const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock('../../shared/db.js', () => ({
  get prisma() {
    return {
      user: { findUnique: async () => ({ active: true }) },
      userRole: {
        findMany: async ({ where }: { where: { userId: string } }) => {
          const codes = userPermissions.get(where.userId) ?? [];
          return [{ role: { permissions: codes.map((c) => ({ permission: { code: c } })) } }];
        },
      },
      $queryRaw: queryRaw,
    };
  },
}));

/** The one query GET /audit ran, as Prisma would send it. */
function sentQuery(): Prisma.Sql {
  expect(queryRaw).toHaveBeenCalledTimes(1);
  const [strings, ...values] = queryRaw.mock.calls[0]! as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
}

describe('GET /api/v1/audit', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ skipConfigValidation: true });
    queryRaw.mockResolvedValue([]);
  });

  afterEach(async () => {
    await app.close();
    userPermissions.clear();
    vi.clearAllMocks();
  });

  function withPermissions(id: string, codes: string[]) {
    userPermissions.set(id, codes);
    return { authorization: `Bearer ${app.jwt.sign({ sub: id, email: 'x@afrinov.local', name: 'Test', roles: [] })}` };
  }
  const as = (role: keyof typeof RolePermissions) => withPermissions(`user-${role}`, RolePermissions[role]!);
  const get = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers });

  it('needs a sign-in', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/audit' })).statusCode).toBe(401);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('is refused, without reading the log, to every role without view:audit_log', async () => {
    const without = (Object.keys(RolePermissions) as Array<keyof typeof RolePermissions>)
      .filter((r) => !RolePermissions[r]!.includes(P.ViewAuditLog));
    expect(without.length).toBeGreaterThan(5);
    for (const role of without) {
      const res = await get('/api/v1/audit', as(role));
      expect(res.statusCode, role).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    }
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('shows Admin every entry: no condition on orders or RFQs', async () => {
    expect((await get('/api/v1/audit', as('ADMIN'))).statusCode).toBe(200);
    const q = sentQuery();
    expect(q.sql).not.toMatch(/WHERE/);
    expect(q.values).toEqual([100]);
  });

  it('hides RFQs, Sales RFQs and project orders from the Store Controller', async () => {
    expect((await get('/api/v1/audit', as('STORE_CONTROLLER'))).statusCode).toBe(200);
    const { sql } = sentQuery();
    expect(sql).toContain(`a.entity_type <> 'Rfq'`);
    expect(sql).toContain(`a.entity_type <> 'SalesRfq'`);
    expect(sql).toContain('po.project_number IS NOT NULL');
    expect(sql).not.toContain('po.project_number IS NULL)');
  });

  it('hides Stores orders from someone who sees project orders but not the store', async () => {
    await get('/api/v1/audit', withPermissions('u-proj', [P.ViewAuditLog, P.ViewPurchaseOrder, P.ViewSalesRfq]));
    const { sql } = sentQuery();
    expect(sql).toContain('po.project_number IS NULL');
    expect(sql).not.toContain(`'Rfq'`);
    expect(sql).not.toContain(`'SalesRfq'`);
  });

  it('hides every order from someone who sees neither kind', async () => {
    await get('/api/v1/audit', withPermissions('u-none', [P.ViewAuditLog]));
    const { sql } = sentQuery();
    expect(sql).toContain(`a.entity_type <> 'PurchaseOrder'`);
    expect(sql).not.toContain('EXISTS');
  });

  it('sends the entity filters and the limit as bound values, not SQL text', async () => {
    const hostile = `x' OR '1'='1`;
    await get(`/api/v1/audit?entityType=${encodeURIComponent(hostile)}&entityId=e-1&limit=7`, as('ADMIN'));
    const q = sentQuery();
    expect(q.values).toEqual([hostile, 'e-1', 7]);
    expect(q.text).not.toContain(hostile);
    expect(q.text).toMatch(/a\.entity_type = \$1 AND a\.entity_id = \$2/);
  });

  it.each(['0', '501', 'abc', '-1', '1.5'])('refuses limit=%s with a 400 and reads nothing', async (limit) => {
    const res = await get(`/api/v1/audit?limit=${limit}`, as('ADMIN'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
