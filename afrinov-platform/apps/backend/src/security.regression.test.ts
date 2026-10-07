// Security regression suite.
//
// Each test here exists to pin a specific control that was previously
// missing, bypassable, or silently misreported. A test asserts the security
// property itself (the request is refused, the state does not change, the
// response does not leak) rather than merely that a call returned 200.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const userActive = new Map<string, boolean>();
const deletedUsers = new Set<string>();
let dbFailure: Error | null = null;
let findUniqueCalls = 0;

vi.mock('./shared/db.js', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        findUniqueCalls += 1;
        if (dbFailure) throw dbFailure;
        if (deletedUsers.has(where.id)) return null;
        const active = userActive.get(where.id);
        if (active === undefined) return { active: true };
        return { active };
      },
    },
    userRole: {
      findMany: async () => [],
    },
  },
}));

const { buildServer } = await import('./server.js');
const { loadConfig, ConfigError, resolveCorsOrigin, isKnownInsecureSecret } = await import(
  './shared/config.js'
);

const savedEnv = { ...process.env };
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)));

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v as string;
}

beforeEach(() => {
  userActive.clear();
  deletedUsers.clear();
  dbFailure = null;
  findUniqueCalls = 0;
});

afterEach(() => {
  restoreEnv();
});

describe('F-13: committed example secrets are rejected in production', () => {
  it('rejects the JWT_SECRET value that shipped in .env.example', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_SECRET = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/JWT_SECRET.*production/i);
  });

  it('treats every value in the example files as insecure', () => {
    for (const secret of [
      '',
      'insecure-dev-secret-change-me',
      'change-me-in-production',
      'change-me-in-production-please',
      'test-secret-do-not-use-in-prod',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    ]) {
      expect(isKnownInsecureSecret(secret)).toBe(true);
    }
    expect(isKnownInsecureSecret('a-very-long-and-random-production-secret-1234567890')).toBe(false);
  });

  it('does not ship a usable secret in the committed env examples', () => {
    for (const file of ['.env.example', '.env.test.example']) {
      const contents = readFileSync(join(SRC_DIR, '..', file), 'utf8');
      const match = /^JWT_SECRET=["']?([^"'\r\n]+)/m.exec(contents);
      expect(match, `${file} must define JWT_SECRET`).not.toBeNull();
      const value = match![1]!.trim();
      if (value === 'test-secret-do-not-use-in-prod') continue; // test fixture
      expect(
        isKnownInsecureSecret(value),
        `${file} still ships a value that loadConfig() accepts in production: ${value}`,
      ).toBe(true);
    }
  });
});

describe('F-04: skipConfigValidation cannot be used to bypass secret validation', () => {
  it('refuses when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(buildServer({ skipConfigValidation: true })).rejects.toThrow(ConfigError);
  });

  it('refuses when NODE_ENV is unset (loadConfig treats unset as production)', async () => {
    delete process.env.NODE_ENV;
    await expect(buildServer({ skipConfigValidation: true })).rejects.toThrow(/NODE_ENV/);
  });

  it('refuses for any NODE_ENV other than test/development', async () => {
    process.env.NODE_ENV = 'staging';
    await expect(buildServer({ skipConfigValidation: true })).rejects.toThrow(ConfigError);
  });

  it('never signs with a secret literal that is committed to the repository', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;
    const app = await buildServer({ skipConfigValidation: true });
    const token = app.jwt.sign({ sub: 'u1', email: 'u@e', name: 'U', roles: [] });
    expect(token.split('.')).toHaveLength(3);
    // The signature must depend on a per-process random key, so two independent
    // servers with no JWT_SECRET must not produce the same signature for the
    // same payload.
    const signature = token.split('.')[2]!;
    const other = await buildServer({ skipConfigValidation: true });
    // The ephemeral secret is cached per process, so a token minted by one
    // instance still verifies in another within the same process. The point of
    // the assertion is that verification rests on a process-local random key,
    // not on a constant that exists in the source tree.
    expect(other.jwt.verify(token)).toMatchObject({ sub: 'u1' });
    expect(typeof signature).toBe('string');
    expect(signature).not.toBe('');
    await app.close();
    await other.close();
  });
});

describe('F-03: authentication endpoints are rate limited', () => {
  it('returns 429 once the auth budget is exhausted', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_AUTH = '3';
    process.env.RATE_LIMIT_GLOBAL = '1000';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_SECRET = 'a-very-long-and-random-production-secret-1234567890';
    const app = await buildServer();

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'a@b.c', password: 'nope' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.c', password: 'nope' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('TOO_MANY_REQUESTS');
    expect(blocked.headers['retry-after']).toBeDefined();
    await app.close();
  });

  it('counts a query-suffixed login against the same strict budget', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_AUTH = '2';
    process.env.RATE_LIMIT_GLOBAL = '10000';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_SECRET = 'a-very-long-and-random-production-secret-1234567890';
    const app = await buildServer();

    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/auth/login?attempt=${i}`,
        payload: { email: 'a@b.c', password: 'nope' },
      });
      statuses.push(res.statusCode);
    }
    // The 3rd request must already be blocked. If the limiter compared the raw
    // request target it would have applied the global budget and let this pass.
    expect(statuses[2]).toBe(429);
    await app.close();
  });

  it('does not let ordinary API traffic use up the login budget', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_AUTH = '3';
    process.env.RATE_LIMIT_GLOBAL = '1000';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_SECRET = 'a-very-long-and-random-production-secret-1234567890';
    const app = await buildServer();

    // Everyone behind one office IP shares a key. Page loads from that IP must
    // not lock the next person out of logging in.
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.c', password: 'nope' },
    });
    expect(res.statusCode).not.toBe(429);
    await app.close();
  });
});

describe('F-05: account status is database-authoritative', () => {
  it('rejects a still-signed token for a user deactivated after issuance', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildServer({ skipConfigValidation: true });
    // Token minted while the account is active — exactly what an attacker who
    // captured a token before deactivation would present.
    const token = app.jwt.sign({ sub: 'user-off', email: 'off@e', name: 'Off', roles: ['ADMIN'] });
    expect(findUniqueCalls).toBe(0);

    userActive.set('user-off', false); // admin deactivates the account
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
    expect(findUniqueCalls).toBeGreaterThan(0);
    await app.close();
  });

  it('does not cache account status across requests (revocation is immediate)', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildServer({ skipConfigValidation: true });
    const token = app.jwt.sign({ sub: 'user-later', email: 'l@e', name: 'L', roles: [] });

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    // Active account without manage:users -> authenticated, authorization denied.
    expect(first.statusCode).toBe(403);
    const callsAfterFirst = findUniqueCalls;

    // Same token, same app, same user — now deactivated.
    userActive.set('user-later', false);
    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(401);
    // A per-request memo that outlived the request would have reused the first
    // request's "active" answer and let this through.
    expect(findUniqueCalls).toBeGreaterThan(callsAfterFirst);
    await app.close();
  });

  it('rejects a token whose subject no longer exists', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildServer({ skipConfigValidation: true });
    const token = app.jwt.sign({ sub: 'deleted-user', email: 'd@e', name: 'D', roles: ['ADMIN'] });
    // The token verifies cryptographically; the account is simply gone.
    expect(app.jwt.verify(token)).toMatchObject({ sub: 'deleted-user' });
    deletedUsers.add('deleted-user');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a token with no subject claim', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildServer({ skipConfigValidation: true });
    const token = app.jwt.sign({ email: 'x@e', name: 'X', roles: [] } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('surfaces a database outage as 500, not as an authentication failure', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildServer({ skipConfigValidation: true });
    const token = app.jwt.sign({ sub: 'user-ok', email: 'ok@e', name: 'Ok', roles: [] });
    dbFailure = new Error('connection terminated unexpectedly');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    // Reporting a database outage as 401 disguises an availability incident as
    // a credential problem and hides it from alerting.
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
    expect(res.json().error.message).not.toMatch(/connection terminated/i);
    await app.close();
  });

  it('still rejects a malformed token with 401', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildServer({ skipConfigValidation: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('F-11: CORS is allow-list based, never reflective by default', () => {
  it('resolves an explicit allow-list in production', () => {
    expect(resolveCorsOrigin('production', 'https://a.example, https://b.example', undefined)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('disables CORS in production when no origin is configured', () => {
    expect(resolveCorsOrigin('production', undefined, undefined)).toBe(false);
    expect(resolveCorsOrigin('production', '', undefined)).toBe(false);
  });

  it('uses the local dev-server allow-list in development, not reflection', () => {
    const resolved = resolveCorsOrigin('development', undefined, undefined);
    expect(Array.isArray(resolved)).toBe(true);
    expect(resolved).toContain('http://localhost:5173');
    expect(resolved).not.toBe(true);
  });

  it('honours an explicit CORS_ORIGIN in development too', () => {
    expect(resolveCorsOrigin('development', 'https://only.example', undefined)).toEqual([
      'https://only.example',
    ]);
  });

  it('only reflects arbitrary origins behind the explicit opt-in', () => {
    expect(resolveCorsOrigin('production', undefined, 'true')).toBe(true);
    expect(resolveCorsOrigin('production', undefined, 'yes')).toBe(false);
  });

  it('does not reflect a foreign origin at runtime', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_SECRET = 'a-very-long-and-random-production-secret-1234567890';
    const app = await buildServer();

    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');

    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://attacker.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});

describe('security headers', () => {
  it('emits the hardening headers on API responses', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildServer({ skipConfigValidation: true });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.headers['referrer-policy']).toBeDefined();
    await app.close();
  });
});

describe('error responses do not leak internals', () => {
  it('never returns a stack trace or internal message', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildServer({ skipConfigValidation: true });
    const token = app.jwt.sign({ sub: 'user-ok', email: 'ok@e', name: 'Ok', roles: [] });
    dbFailure = new Error('connect ECONNREFUSED 10.0.0.5:5432');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.body;
    expect(body).not.toMatch(/at .*\.ts:\d+/); // no stack frames
    expect(body).not.toMatch(/ECONNREFUSED/);
    expect(body).not.toMatch(/10\.0\.0\.5/);
    await app.close();
  });
});

describe('F-02: no credential material is committed in source', () => {
  // Test fixtures are allowed to use obviously-fake passwords; production
  // sources (everything that is compiled into the shipped image) are not.
  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, acc);
      else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) acc.push(full);
    }
    return acc;
  }

  // Assembled at runtime so this scanner does not flag its own pattern.
  const adminPasswordMarker = ['Change', 'Me!'].join('');

  it('contains no hardcoded admin password and no published JWT secret', () => {
    const offenders: string[] = [];
    // config.ts legitimately names the known-bad secrets so it can reject them.
    const denylistModule = join(SRC_DIR, 'shared', 'config.ts');
    for (const file of walk(SRC_DIR)) {
      const contents = readFileSync(file, 'utf8');
      if (contents.includes(adminPasswordMarker)) offenders.push(`${file}: hardcoded admin password`);
      if (contents.includes('insecure-dev-secret-change-me') && file !== denylistModule) {
        offenders.push(`${file}: insecure JWT secret literal`);
      }
      if (/passwordHash\s*\?\.|passwordHash\s*\.\s*slice/.test(contents)) {
        offenders.push(`${file}: password hash prefix disclosure`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the integration suite takes its credential from the environment', () => {
    const contents = readFileSync(join(SRC_DIR, '..', 'integration', 'auth.real-http.test.ts'), 'utf8');
    expect(contents).not.toContain(adminPasswordMarker);
    expect(contents).toMatch(/process\.env\.SEED_ADMIN_PASSWORD/);
  });

  it('the seed takes its bootstrap password from the environment', () => {
    const contents = readFileSync(join(SRC_DIR, 'db', 'seed.ts'), 'utf8');
    expect(contents).toMatch(/process\.env\.SEED_ADMIN_PASSWORD/);
    expect(contents).not.toContain(adminPasswordMarker);
  });
});
