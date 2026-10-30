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
  mustChangePassword?: boolean;
  passwordChangedAt?: Date | null;
  failedLoginCount?: number;
  lockedUntil?: Date | null;
}

interface AuditRow { actorId: string | null; action: string; entityType: string; entityId: string; after?: Record<string, unknown> }

const db = {
  users: new Map<string, UserRow>(),
  audit: [] as AuditRow[],
};

let validHash: string;

beforeAll(async () => {
  validHash = await bcrypt.hash('Correct-Horse-Battery-9', 10);
});

beforeEach(() => {
  db.users.clear();
  db.audit = [];
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
    const client = {
      user: {
        findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
          if (where.id) {
            return [...db.users.values()].find((u) => u.id === where.id) ?? null;
          }
          return [...db.users.values()].find((u) => u.email === where.email) ?? null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const u = db.users.get(where.id)!;
          for (const [k, v] of Object.entries(data)) {
            const inc = (v as { increment?: number } | null)?.increment;
            (u as unknown as Record<string, unknown>)[k] = inc !== undefined ? Number((u as unknown as Record<string, unknown>)[k] ?? 0) + inc : v;
          }
          return u;
        },
      },
      auditLogEntry: {
        create: async ({ data }: { data: AuditRow }) => { db.audit.push(data); return data; },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    };
    return client;
  },
}));

function tokenFor(sub = 'user-active', opts: { iat?: number } = {}): string {
  return opts.iat === undefined
    ? appRef.jwt.sign({ sub, email: 'alice@afrinov.local', name: 'Alice', roles: ['ADMIN'] })
    : appRef.jwt.sign({ sub, email: 'alice@afrinov.local', name: 'Alice', roles: ['ADMIN'], iat: opts.iat });
}
let appRef: FastifyInstance;

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ skipConfigValidation: true });
    appRef = app;
  });

  afterEach(async () => {
    await app.close();
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

    const signIn = (password: string, email = 'alice@afrinov.local') =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, headers: { 'user-agent': 'vitest' } });

    it('audits every attempt, with where it came from, and never the typed email of an unknown account', async () => {
      await signIn('Correct-Horse-Battery-9');
      await signIn('wrong-password');
      await signIn('whatever', 'nobody@afrinov.local');
      expect(db.audit.map((a) => [a.action, a.entityType, a.after?.['reason'] ?? null])).toEqual([
        ['LOGIN_SUCCEEDED', 'Authentication', null],
        ['LOGIN_FAILED', 'Authentication', 'wrong_password'],
        ['LOGIN_FAILED', 'Authentication', 'unknown_account'],
      ]);
      expect(db.audit[0]!.after).toMatchObject({ ip: expect.any(String), userAgent: 'vitest' });
      expect(JSON.stringify(db.audit[2])).not.toContain('nobody@afrinov.local');
    });

    it('locks the account after five wrong passwords in a row, even with the right one', async () => {
      for (let i = 0; i < 5; i++) expect((await signIn('wrong-password')).statusCode).toBe(401);
      const locked = await signIn('Correct-Horse-Battery-9');
      expect(locked.statusCode).toBe(429);
      expect(locked.json().error.code).toBe('ACCOUNT_LOCKED');
      expect(db.audit.at(-1)!.action).toBe('LOGIN_LOCKED');
    });

    it('opens again once the lockout has passed, and a success clears the count', async () => {
      db.users.get('user-active')!.lockedUntil = new Date(Date.now() - 1000);
      db.users.get('user-active')!.failedLoginCount = 3;
      expect((await signIn('Correct-Horse-Battery-9')).statusCode).toBe(200);
      expect(db.users.get('user-active')).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    });

    it('does not lock an inactive account for a right password', async () => {
      db.users.get('user-active')!.active = false;
      for (let i = 0; i < 6; i++) expect((await signIn('Correct-Horse-Battery-9')).statusCode).toBe(401);
      expect(db.users.get('user-active')!.lockedUntil ?? null).toBeNull();
    });

    it('tells the client when the password must be changed', async () => {
      db.users.get('user-active')!.mustChangePassword = true;
      const res = await signIn('Correct-Horse-Battery-9');
      expect(res.json().user.mustChangePassword).toBe(true);
    });
  });

  describe('password changes', () => {
    const change = (token: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/password', headers: { authorization: `Bearer ${token}` }, payload });

    it('changes the password, returns a working token and refuses tokens issued before', async () => {
      const old = tokenFor('user-active', { iat: Math.floor(Date.now() / 1000) - 60 });
      const res = await change(old, { currentPassword: 'Correct-Horse-Battery-9', newPassword: 'a-much-longer-passphrase' });
      expect(res.statusCode).toBe(200);
      const { token } = res.json<{ token: string }>();
      expect(await bcrypt.compare('a-much-longer-passphrase', db.users.get('user-active')!.passwordHash)).toBe(true);
      expect(db.audit.at(-1)).toMatchObject({ action: 'PASSWORD_CHANGE', entityType: 'User', entityId: 'user-active' });

      const withOld = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${old}` } });
      expect(withOld.statusCode).toBe(401);
      const withNew = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
      expect(withNew.statusCode).toBe(200);
    });

    it('needs the current password', async () => {
      const res = await change(tokenFor(), { currentPassword: 'wrong', newPassword: 'a-much-longer-passphrase' });
      // 400, not 401: the session is still good, and a 401 would sign the client out.
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Your current password is not correct.' });
    });

    it('enforces the rules: at least 12 characters, not the current password, not the email', async () => {
      expect((await change(tokenFor(), { currentPassword: 'Correct-Horse-Battery-9', newPassword: 'short' })).statusCode).toBe(400);
      expect((await change(tokenFor(), { currentPassword: 'Correct-Horse-Battery-9', newPassword: 'Correct-Horse-Battery-9' })).json().error.code).toBe('VALIDATION_ERROR');
      db.users.get('user-active')!.email = 'alice.long@afrinov.local';
      expect((await change(tokenFor(), { currentPassword: 'Correct-Horse-Battery-9', newPassword: 'ALICE.LONG@afrinov.local' })).json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('forced password change', () => {
    it('allows only /auth/me and /auth/password until the password is changed', async () => {
      db.users.get('user-active')!.mustChangePassword = true;
      const token = tokenFor();
      const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
      expect(me.statusCode).toBe(200);
      expect(me.json().mustChangePassword).toBe(true);

      const other = await app.inject({ method: 'GET', url: '/api/v1/materials', headers: { authorization: `Bearer ${token}` } });
      expect(other.statusCode).toBe(403);
      expect(other.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const changed = await app.inject({
        method: 'POST', url: '/api/v1/auth/password', headers: { authorization: `Bearer ${token}` },
        payload: { currentPassword: 'Correct-Horse-Battery-9', newPassword: 'a-much-longer-passphrase' },
      });
      expect(changed.statusCode).toBe(200);
      expect(db.users.get('user-active')!.mustChangePassword).toBe(false);
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
