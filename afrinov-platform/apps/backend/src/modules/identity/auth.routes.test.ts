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
  roles: { role: { id: string; name: string; permissions: { permission: { code: string } }[] } }[];
}

const db = {
  users: new Map<string, UserRow>(),
  // security.sessionTimeoutMinutes as stored; undefined: no row, so the default.
  sessionTimeoutMinutes: undefined as unknown,
};

let validHash: string;

beforeAll(async () => {
  validHash = await bcrypt.hash('Correct-Horse-Battery-9', 10);
});

beforeEach(() => {
  db.sessionTimeoutMinutes = undefined;
  db.users.clear();
  db.users.set('user-active', {
    id: 'user-active',
    email: 'alice@afrinov.local',
    name: 'Alice',
    passwordHash: validHash,
    active: true,
    roles: [{ role: { id: 'r-1', name: 'ADMIN', permissions: [{ permission: { code: 'approve:write_off' } }, { permission: { code: 'adjust:inventory' } }] } }],
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
      userRole: {
        findMany: async ({ where }: { where: { userId: string } }) => db.users.get(where.userId)?.roles ?? [],
      },
      setting: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          where.key === 'security.sessionTimeoutMinutes' && db.sessionTimeoutMinutes !== undefined
            ? { key: where.key, value: db.sessionTimeoutMinutes }
            : null,
      },
    };
  },
}));

interface Claims { sub: string; iat: number; exp: number; auth_time?: number; roles: string[] }

/** Moves the clock the server and the token signer read; timers keep running. */
function at(isoOrMs: string | number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs));
}
const seconds = (ms: number) => Math.floor(ms / 1000);

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ skipConfigValidation: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  async function signIn(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@afrinov.local', password: 'Correct-Horse-Battery-9' },
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ token: string }>().token;
  }
  const me = (token: string) => app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
  const refresh = (token?: string) => app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  // ADR-035: security.sessionTimeoutMinutes signs out a screen left alone.
  describe('session timeout', () => {
    it('issues a sign-in token that lasts the idle time and records when the sign-in began', async () => {
      at('2026-11-11T08:00:00Z');
      const claims = app.jwt.decode<Claims>(await signIn())!;
      expect(claims.exp - claims.iat).toBe(60 * 60);
      expect(claims.auth_time).toBe(claims.iat);
    });

    it('follows the setting', async () => {
      db.sessionTimeoutMinutes = 15;
      at('2026-11-11T08:00:00Z');
      const claims = app.jwt.decode<Claims>(await signIn())!;
      expect(claims.exp - claims.iat).toBe(15 * 60);
    });

    it('lets a token through within the idle time and refuses it after', async () => {
      db.sessionTimeoutMinutes = 5;
      at('2026-11-11T08:00:00Z');
      const token = await signIn();
      at('2026-11-11T08:04:59Z');
      expect((await me(token)).statusCode).toBe(200);
      at('2026-11-11T08:05:02Z');
      const res = await me(token);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    // A token's expiry holds the idle time it was issued with; a shorter
    // setting must not wait for that to run out.
    it('applies a shorter setting to tokens already issued', async () => {
      at('2026-11-11T08:00:00Z');
      const token = await signIn();
      db.sessionTimeoutMinutes = 5;
      at('2026-11-11T08:06:00Z');
      expect((await me(token)).statusCode).toBe(401);
    });

    it('renews a token for the idle time from now, keeping when the sign-in began', async () => {
      db.sessionTimeoutMinutes = 30;
      at('2026-11-11T08:00:00Z');
      const first = await signIn();
      const signedInAt = app.jwt.decode<Claims>(first)!.auth_time;
      at('2026-11-11T08:20:00Z');
      const res = await refresh(first);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ token: string; user: { id: string; roles: string[]; permissions: string[] } }>();
      const claims = app.jwt.decode<Claims>(body.token)!;
      expect(claims.iat).toBe(seconds(Date.parse('2026-11-11T08:20:00Z')));
      expect(claims.exp - claims.iat).toBe(30 * 60);
      expect(claims.auth_time).toBe(signedInAt);
      expect(body.user.id).toBe('user-active');
      // Past the first token's idle time, the renewed one still works.
      at('2026-11-11T08:45:00Z');
      expect((await me(body.token)).statusCode).toBe(200);
    });

    it('renews with the roles as they are now, not as the old token had them', async () => {
      at('2026-11-11T08:00:00Z');
      const token = await signIn();
      db.users.get('user-active')!.roles = [{ role: { id: 'r-2', name: 'VIEWER', permissions: [] } }];
      const res = await refresh(token);
      expect(res.statusCode).toBe(200);
      expect(app.jwt.decode<Claims>(res.json<{ token: string }>().token)!.roles).toEqual(['VIEWER']);
      expect(res.json<{ user: { roles: string[] } }>().user.roles).toEqual(['VIEWER']);
    });

    it('never renews past 12 hours from sign-in', async () => {
      at('2026-11-11T08:00:00Z');
      let token = await signIn();
      const signedInAt = app.jwt.decode<Claims>(token)!.auth_time!;
      // Active all day: renewed every 50 minutes.
      for (let minutes = 50; minutes < 12 * 60 - 30; minutes += 50) {
        at(Date.parse('2026-11-11T08:00:00Z') + minutes * 60_000);
        const res = await refresh(token);
        expect(res.statusCode).toBe(200);
        token = res.json<{ token: string }>().token;
      }
      at('2026-11-11T19:40:00Z');
      const last = await refresh(token);
      expect(last.statusCode).toBe(200);
      expect(app.jwt.decode<Claims>(last.json<{ token: string }>().token)!.exp).toBe(signedInAt + 12 * 60 * 60);
    });

    it('refuses to renew once the 12 hours are up', async () => {
      at('2026-11-11T08:00:00Z');
      // A token issued just now for a sign-in that began 12 hours ago.
      const token = app.jwt.sign({
        sub: 'user-active', email: 'alice@afrinov.local', name: 'Alice', roles: ['ADMIN'],
        auth_time: seconds(Date.parse('2026-11-10T20:00:00Z')),
      });
      const res = await refresh(token);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('renews a token issued before sign-ins recorded their start, counting from its issue', async () => {
      at('2026-11-11T08:00:00Z');
      const legacy = app.jwt.sign({ sub: 'user-active', email: 'alice@afrinov.local', name: 'Alice', roles: ['ADMIN'] });
      at('2026-11-11T08:10:00Z');
      const res = await refresh(legacy);
      expect(res.statusCode).toBe(200);
      expect(app.jwt.decode<Claims>(res.json<{ token: string }>().token)!.auth_time).toBe(seconds(Date.parse('2026-11-11T08:00:00Z')));
    });

    it('refuses to renew without a token, with an expired one, or for an account since deactivated', async () => {
      expect((await refresh()).statusCode).toBe(401);
      at('2026-11-11T08:00:00Z');
      const token = await signIn();
      at('2026-11-11T09:00:01Z');
      expect((await refresh(token)).statusCode).toBe(401);
      at('2026-11-11T08:30:00Z');
      db.users.get('user-active')!.active = false;
      expect((await refresh(token)).statusCode).toBe(401);
    });

    it('is POST only', async () => {
      at('2026-11-11T08:00:00Z');
      const token = await signIn();
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/refresh', headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(404);
    });
  });

  it('keeps login POST-only at the single API prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/login' });
    expect(res.statusCode).toBe(404);
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
      // What the roles grant, so the screens follow grants outside their own role table.
      expect((body.user as unknown as { permissions: string[] }).permissions).toEqual(['adjust:inventory', 'approve:write_off']);
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
        roles: [{ role: { id: 'r-2', name: 'VIEWER', permissions: [] } }],
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
      expect((body as unknown as { permissions: string[] }).permissions).toEqual(['adjust:inventory', 'approve:write_off']);
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

    it('rejects an expired token', async () => {
      const token = app.jwt.sign({
        sub: 'user-active',
        email: 'alice@afrinov.local',
        name: 'Alice',
        roles: ['ADMIN'],
      }, { expiresIn: -1 });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects an incorrectly signed token', async () => {
      const token = app.jwt.sign({
        sub: 'user-active',
        email: 'alice@afrinov.local',
        name: 'Alice',
        roles: ['ADMIN'],
      });
      const [header, payload, signature] = token.split('.');
      const replacement = signature?.startsWith('a') ? 'b' : 'a';
      const tampered = `${header}.${payload}.${replacement}${signature?.slice(1) ?? ''}`;
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tampered}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects HMAC algorithms outside the configured HS256 allow-list', async () => {
      const token = app.jwt.sign({
        sub: 'user-active',
        email: 'alice@afrinov.local',
        name: 'Alice',
        roles: ['ADMIN'],
      }, { algorithm: 'HS384' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
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
