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
  if (!password?.trim()) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required for the real-HTTP integration suites. ' +
        'Seed the database with that value before running this config.',
    );
  }
  return password;
}

/**
 * An item made inactive before it had to be clear first, holding what it holds:
 * the API refuses this now, so it is written straight to the database, with the
 * status record such an item has.
 */
export async function retireAsBefore(materialId: string): Promise<void> {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  await prisma.material.update({ where: { id: materialId }, data: { active: false } });
  await prisma.materialStatusChange.create({ data: { materialId, active: false, actorId: admin.id } });
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
  // Adjustments post at once, as most suites set up stock with them; the
  // write-off approval suite switches approval on for its own tests.
  await prisma.setting.update({ where: { key: 'inventory.requireWriteOffApproval' }, data: { value: false } });
  const app = await buildServer(opts);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  return { app, port, close: () => app.close() };
}

export interface ApiResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

/** Calls the API over a real socket. `token` is sent as a bearer token. */
export function client(port: number, token?: string) {
  return async function call<T = unknown>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (extraHeaders) Object.assign(headers, extraHeaders);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  };
}

/**
 * Signs in a second admin, made for the run, who signs as the Procurement
 * Manager. Nobody signs an order they raised, so an order the bootstrap admin
 * raises is signed by this one.
 */
export async function secondAdmin(port: number, api: ReturnType<typeof client>, run: string): Promise<ReturnType<typeof client>> {
  const email = `it-checker-${run}@afrinov.local`;
  const password = `It-${run}-checker`;
  const made = await api('POST', '/users', { email, name: `IT Checker ${run}`, password, roleNames: ['ADMIN', 'PROCUREMENT_MANAGER'], mustChangePassword: false });
  if (made.status !== 201) throw new Error(`Creating the second admin failed with ${made.status}: ${JSON.stringify(made.body)}`);
  return client(port, await login(port, email, password));
}

export async function login(port: number, email: string, password: string): Promise<string> {
  const res = await client(port)<{ token: string }>('POST', '/auth/login', { email, password });
  if (res.status !== 200) {
    throw new Error(`Login as ${email} failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

/**
 * ADR-002 invariant: the stored balance for a (material, location, project
 * held for) equals the sum of its ledger transactions. Stores stock unless a
 * project is given. Read straight from the database so the check does not
 * depend on the API code under test.
 */
export async function ledgerAndBalance(materialId: string, locationId: string, heldForProject: string | null = null): Promise<{ ledger: string; balance: string }> {
  const [agg, row] = await Promise.all([
    prisma.inventoryTransaction.aggregate({ where: { materialId, locationId, heldForProject }, _sum: { quantity: true } }),
    prisma.inventoryBalance.findUnique({ where: { materialId_locationId_heldForProject: { materialId, locationId, heldForProject: heldForProject ?? '' } } }),
  ]);
  return {
    ledger: (agg._sum.quantity ?? 0).toString(),
    balance: (row?.quantity ?? 0).toString(),
  };
}

export { prisma };

/**
 * Gives the seeded admin the Procurement Manager's role, so a test can sign its
 * small orders with the one client: Admin alone doesn't sign (po-approval.ts).
 */
export async function letAdminSign(api: ReturnType<typeof client>): Promise<void> {
  const users = await api<Array<{ id: string; email: string }>>('GET', '/users');
  const admin = users.body.find((u) => u.email === ADMIN_EMAIL)!;
  const updated = await api('PATCH', `/users/${admin.id}`, { roleNames: ['ADMIN', 'PROCUREMENT_MANAGER'] });
  if (updated.status !== 200) throw new Error(`Could not give the admin a signing role: ${updated.status}`);
}

/**
 * Receives everything an order still owes on Receive stock, in one posted
 * goods receipt, as the store books a delivery. The receive-all route this
 * replaces is retired (system audit D3). Returns the response to the receipt.
 */
export async function receiveOutstanding(
  call: ReturnType<typeof client>, orderId: string, locationId: string,
): Promise<ApiResponse<{ id: string; status: string; error?: { code: string; message: string } }>> {
  const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  const lines = order.lines
    .filter((l) => l.orderedQty.gt(l.receivedQty))
    .map((l) => ({ materialId: l.materialId, locationId, quantity: Number(l.orderedQty.minus(l.receivedQty)), purchaseOrderLineId: l.id }));
  return call('POST', '/goods-receipts', { purchaseOrderId: orderId, supplierId: order.supplierId, deliveryRef: `DN-${orderId.slice(0, 8)}`, lines, post: true });
}
