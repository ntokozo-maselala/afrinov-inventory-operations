// Shared plumbing for the real-HTTP integration suites: boot a real server on
// an ephemeral port, log in over HTTP, and call the API as a given user.
//
// Every suite runs against the same seeded database and leaves its rows behind
// (the ledger is append-only), so suites create their own materials,
// locations and suppliers with a per-run suffix instead of relying on seed
// data that other suites might move.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer, type BuildServerOptions } from '../src/server.js';
import { prisma } from '../src/shared/db.js';

export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@afrinov.local';

export function requireAdminPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required for the real-HTTP integration suites. ' +
        'Seed the database with that value before running this config.',
    );
  }
  return password;
}

/** Short random suffix that keeps this run's rows apart from earlier runs. */
export function runId(): string {
  return randomBytes(4).toString('hex');
}

export interface TestServer {
  app: FastifyInstance;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(opts: BuildServerOptions = {}): Promise<TestServer> {
  const app = await buildServer(opts);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  return { app, port, close: () => app.close() };
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

/** Calls the API over a real socket. `token` is sent as a bearer token. */
export function client(port: number, token?: string) {
  return async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
}

export async function login(port: number, email: string, password: string): Promise<string> {
  const res = await client(port)<{ token: string }>('POST', '/auth/login', { email, password });
  if (res.status !== 200) {
    throw new Error(`Login as ${email} failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

/**
 * ADR-002 invariant: the stored balance for a (material, location) equals the
 * sum of its ledger transactions. Read straight from the database so the check
 * does not depend on the API code under test.
 */
export async function ledgerAndBalance(materialId: string, locationId: string): Promise<{ ledger: string; balance: string }> {
  const [agg, row] = await Promise.all([
    prisma.inventoryTransaction.aggregate({ where: { materialId, locationId }, _sum: { quantity: true } }),
    prisma.inventoryBalance.findUnique({ where: { materialId_locationId: { materialId, locationId } } }),
  ]);
  return {
    ledger: (agg._sum.quantity ?? 0).toString(),
    balance: (row?.quantity ?? 0).toString(),
  };
}

export { prisma };
