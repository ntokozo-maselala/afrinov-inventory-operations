// HTTP-level tests for the authentication endpoints (POST /auth/login,
// GET /auth/me).
//
// These complement the service-layer AuthService tests with full
// request → response coverage: payload validation, credential
// verification, JWT issuance, and the /auth/me identity contract.
//
// The DB is mocked (in-memory) so no real PostgreSQL is required; only the
// `user` model is exercised because auth routes don't touch other tables.
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { buildServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';

interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  active: boolean;
  roles: { role: { id: string; name: string } }[];
}

const db = {
  users: new Map<string, UserRow>(),
};

let validHash: string;

beforeAll(async () => {
  validHash = await bcrypt.hash('Correct-Horse-Battery-9', 10);
});

beforeEach(() => {
  db.users.clear();
  db.users.set('user-active', {
    id: 'user-active',
    email: 'alice@afrinov.local',
    name: 'Alice',
    passwordHash: validHash,
    active: true,
    roles: [{ role: { id: 'r-1', name: 'ADMIN' } }],
  });
});

vi.mock('../../shared/db.js', () => ({
  get prisma() {
    return {
      user: {
        findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
          if (where.id) {
            return [...db.users.values()].find((u) => u.id === where.id) ?? null;
          }
          return [...db.users.values()].find((u) => u.email === where.email) ?? null;
        },
      },
    };
  },
}));

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ skipConfigValidation: true });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 200, a token, and the user on valid credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'alice@afrinov.local', password: 'Correct-Horse-Battery-9' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ token: string; user: { id: string; email: string; name: string; active: boolean; roles: string[] } }>();
      expect(body.token).toBeTruthy();
      expect(body.user.email).toBe('alice@afrinov.local');
      expect(body.user.name).toBe('Alice');
      expect(body.user.active).toBe(true);
      expect(body.user.roles).toEqual(['ADMIN']);
    });

    it('returns 400 when the payload is missing', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when the email is not a valid email address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'not-an-email', password: 'whatever' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 when the password is wrong', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'alice@afrinov.local', password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 when the user does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@afrinov.local', password: 'whatever' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 when the user exists but is inactive', async () => {
      db.users.set('user-inactive', {
        id: 'user-inactive',
        email: 'bob@afrinov.local',
        name: 'Bob',
        passwordHash: validHash,
        active: false,
        roles: [{ role: { id: 'r-2', name: 'VIEWER' } }],
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'bob@afrinov.local', password: 'Correct-Horse-Battery-9' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns 401 when no Authorization header is supplied', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('returns the user identity for a valid token', async () => {
      const token = app.jwt.sign({
        sub: 'user-active',
        email: 'alice@afrinov.local',
        name: 'Alice',
        roles: ['ADMIN'],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ id: string; email: string; name: string; roles: string[] }>();
      expect(body.id).toBe('user-active');
      expect(body.email).toBe('alice@afrinov.local');
      expect(body.name).toBe('Alice');
      expect(body.roles).toEqual(['ADMIN']);
    });

    it('returns 401 for a malformed token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer not-a-real-jwt' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('omits the password hash from the /me response', async () => {
      const token = app.jwt.sign({
        sub: 'user-active',
        email: 'alice@afrinov.local',
        name: 'Alice',
        roles: ['ADMIN'],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect('passwordHash' in body).toBe(false);
      expect('password' in body).toBe(false);
    });
  });

  it('offers no self-registration: accounts are created by an administrator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Someone', email: 'someone@example.com', password: 'longenough' },
    });
    expect(res.statusCode).toBe(404);
  });
});
