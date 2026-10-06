// API smoke tests — verify the HTTP server builds and the documented error
// contract is honoured. We don't exercise authenticated flows here (those
// require a database); this just proves the server, error model, and route
// registration work end-to-end.

import { describe, it, expect, vi } from 'vitest';
import { buildServer } from './server.js';

const mockUserActive = new Map<string, boolean>();

vi.mock('./shared/db.js', () => ({
  get prisma() {
    return {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const active = mockUserActive.get(where.id);
          if (active === undefined) return { active: true };
          return { active };
        },
      },
      userRole: {
        findMany: async () => [],
      },
    };
  },
}));

describe('HTTP server', () => {
  it('GET /health returns ok', async () => {
    const app = await buildServer({ skipConfigValidation: true });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    await app.close();
  });

  it('GET /api/v1/materials without auth returns 401', async () => {
    const app = await buildServer({ skipConfigValidation: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/materials' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('POST /auth/login with missing payload returns 400', async () => {
    const app = await buildServer({ skipConfigValidation: true });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('GET /users without auth returns 401', async () => {
    const app = await buildServer({ skipConfigValidation: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('GET /users with inactive account returns 401', async () => {
    mockUserActive.set('user-inactive', false);
    const app = await buildServer({ skipConfigValidation: true });
    const token = app.jwt.sign({ sub: 'user-inactive', email: 'inactive@test', name: 'Inactive', roles: ['VIEWER'] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('GET /users with active account but no permission returns 403', async () => {
    mockUserActive.set('user-no-active', true);
    const app = await buildServer({ skipConfigValidation: true });
    const token = app.jwt.sign({ sub: 'user-no-active', email: 'noactive@test', name: 'No Active', roles: ['VIEWER'] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });
});
