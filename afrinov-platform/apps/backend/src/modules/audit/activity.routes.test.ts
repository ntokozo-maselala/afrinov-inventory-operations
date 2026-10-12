// HTTP tests for GET /activity: only people allowed to read the audit log
// (Admin and Store Controller) see it, and its filters reach the service.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { RolePermissions } from '../../shared/permissions.js';

const userPermissions = new Map<string, string[]>();
const { mockedList, mockedActors } = vi.hoisted(() => ({ mockedList: vi.fn(), mockedActors: vi.fn() }));

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
    };
  },
}));
vi.mock('./activity.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./activity.service.js')>()),
  ActivityService: { list: mockedList, actors: mockedActors },
}));

describe('GET /api/v1/activity', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ skipConfigValidation: true });
    mockedList.mockResolvedValue([]);
    mockedActors.mockResolvedValue([]);
  });

  afterEach(async () => {
    await app.close();
    userPermissions.clear();
    vi.clearAllMocks();
  });

  function as(role: keyof typeof RolePermissions) {
    userPermissions.set(`user-${role}`, RolePermissions[role]!);
    return { authorization: `Bearer ${app.jwt.sign({ sub: `user-${role}`, email: 'x@afrinov.local', name: 'Test', roles: [role] })}` };
  }

  it('is open to Admin and Store Controller', async () => {
    for (const role of ['ADMIN', 'STORE_CONTROLLER'] as const) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: as(role) });
      expect(res.statusCode, role).toBe(200);
    }
  });

  it('is refused to every other role, and so is the list of who did things', async () => {
    for (const role of ['PROCUREMENT', 'APPROVER', 'TECHNICIAN', 'VIEWER'] as const) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/activity', headers: as(role) })).statusCode, role).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/api/v1/activity/actors', headers: as(role) })).statusCode, role).toBe(403);
    }
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('passes the dates, type, person, location and cursor to the service', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/v1/activity?from=2026-10-12&to=2026-10-12&entityType=StockCount&actorId=u-1&locationId=l-1&before=c&limit=5',
      headers: as('STORE_CONTROLLER'),
    });
    expect(mockedList).toHaveBeenCalledWith({
      from: '2026-10-12', to: '2026-10-12', entityType: 'StockCount', actorId: 'u-1', locationId: 'l-1', before: 'c', limit: 5,
    });
  });
});
