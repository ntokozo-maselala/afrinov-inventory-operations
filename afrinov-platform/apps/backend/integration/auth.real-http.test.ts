// Real-HTTP + real-database integration tests.
//
// These tests boot a REAL Fastify server from src/server.ts on an ephemeral
// port and issue HTTP requests over actual TCP sockets against the LIVE local
// PostgreSQL database (no Prisma mock). This validates the full request path:
//   browser/client --> HTTP socket --> Fastify --> Prisma --> PostgreSQL --> response
//
// Run with: npx vitest run --config vitest.integration.config.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

// Bootstrap credentials for a REAL seeded admin account. The seed no longer
// ships a known password: it hashes `SEED_ADMIN_PASSWORD` when supplied and
// otherwise generates a random one that is never printed. These tests
// therefore cannot carry a credential in source — the operator must point them
// at a database seeded with a password they supply.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@afrinov.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

// Origin the API is expected to reflect. Configure CORS_ORIGIN to match.
const ALLOWED_ORIGIN = 'http://localhost:5173';
const DISALLOWED_ORIGIN = 'http://attacker.example';

function url(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

describe('real HTTP + real database', () => {
  let app: FastifyInstance;
  let port: number;
  let jwt: string | null = null;

  beforeAll(async () => {
    if (!ADMIN_PASSWORD) {
      throw new Error(
        'SEED_ADMIN_PASSWORD is required for the real-HTTP integration suite. ' +
          'Seed the database with that value before running this config.',
      );
    }
    process.env.CORS_ORIGIN = ALLOWED_ORIGIN;
    app = await buildServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/ready reports a live database connection', async () => {
    const res = await fetch(url(port, '/health/ready'));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; database: string };
    expect(body.status).toBe('ready');
    expect(body.database).toBe('connected');
  });

  it('POST /api/v1/auth/login authenticates over HTTP and reflects an allowed CORS origin', async () => {
    const res = await fetch(url(port, '/api/v1/auth/login'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });

    // Core regression: a real login over a real socket returns 200.
    expect(res.status).toBe(200);

    // Only the configured origin is reflected.
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');

    const body = await res.json() as { token: string; user: { email: string; roles: string[] } };
    expect(body.token).toMatch(/^eyJ/); // compact JWT
    expect(body.user.email).toBe(ADMIN_EMAIL);
    expect(body.user.roles).toContain('ADMIN');
    jwt = body.token;
  });

  it('does not reflect an origin that is not on the CORS allow-list', async () => {
    const res = await fetch(url(port, '/api/v1/auth/login'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: DISALLOWED_ORIGIN,
      },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    // The request still executes server-side; what must not happen is the API
    // granting a foreign origin credentialed access to the response.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects invalid credentials over HTTP', async () => {
    const res = await fetch(url(port, '/api/v1/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/auth/me authorizes a valid token over HTTP', async () => {
    expect(jwt).not.toBeNull();
    const res = await fetch(url(port, '/api/v1/auth/me'), {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { email: string; roles: string[] };
    expect(body.email).toBe(ADMIN_EMAIL);
    expect(body.roles).toContain('ADMIN');
  });

  it('GET /api/v1/auth/me rejects a missing token with 401', async () => {
    const res = await fetch(url(port, '/api/v1/auth/me'));
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/materials returns seeded catalog over HTTP', async () => {
    const res = await fetch(url(port, '/api/v1/materials'), {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});
