// HTTP tests for GET /settings?category: a section the database doesn't know
// is a 400, not an invalid enum value sent to the database (a 500 before).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { RolePermissions } from '../../shared/permissions.js';

const userPermissions = new Map<string, string[]>();
const { mockedList } = vi.hoisted(() => ({ mockedList: vi.fn() }));

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
vi.mock('./settings.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./settings.service.js')>();
  return { ...original, SettingsService: { ...original.SettingsService, list: mockedList } };
});

describe('GET /api/v1/settings', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ skipConfigValidation: true });
    mockedList.mockResolvedValue([]);
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

  it('lists every setting when no section is named', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: as('VIEWER') });
    expect(res.statusCode).toBe(200);
    expect(mockedList).toHaveBeenCalledWith(undefined);
  });

  it('lists one section, and a section with no settings is still an empty list', async () => {
    for (const category of ['inventory', 'notifications'] as const) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/settings?category=${category}`, headers: as('VIEWER') });
      expect(res.statusCode, category).toBe(200);
      expect(mockedList).toHaveBeenLastCalledWith({ category });
    }
  });

  it('refuses a section that does not exist with a 400, before the database is asked', async () => {
    for (const category of ['a', '%25', "o'brien", 'INVENTORY']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/settings?category=${category}`, headers: as('VIEWER') });
      expect(res.statusCode, category).toBe(400);
      expect(res.json().error.code, category).toBe('VALIDATION_ERROR');
    }
    expect(mockedList).not.toHaveBeenCalled();
  });
});
