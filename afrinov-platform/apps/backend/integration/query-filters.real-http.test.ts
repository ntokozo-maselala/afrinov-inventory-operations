// Real-HTTP + real-database tests for enum filters read from the query string.
// A value outside the enum reached Prisma, whose refusal carries no error code,
// so these lists answered 500 and logged an "Unhandled error" for a mistyped
// filter: found by probing every GET route with bad values (production
// readiness review, PRR-02). Each must now be a 400 naming the filter, while
// every real value, and an empty one, still lists as before.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

/** Path, the filter it reads, and a value the enum has. */
const FILTERS: Array<[string, string, string]> = [
  ['/materials', 'category', 'CONSUMABLES'],
  ['/locations', 'type', 'RACK'],
  ['/inventory-transactions', 'type', 'ADJUSTMENT'],
  ['/inventory-transactions/summary', 'type', 'ADJUSTMENT'],
  ['/inventory-transactions/export', 'type', 'ADJUSTMENT'],
  ['/reports/current-stock', 'category', 'CONSUMABLES'],
  ['/reports/movement-history', 'type', 'ADJUSTMENT'],
  ['/reports/stock-status', 'category', 'CONSUMABLES'],
  ['/reports/consumption', 'category', 'CONSUMABLES'],
  ['/reports/consumption/export', 'category', 'CONSUMABLES'],
  ['/reports/reorder-list/export', 'category', 'CONSUMABLES'],
];

describe('enum filters over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let token: string;

  beforeAll(async () => {
    server = await startServer();
    token = await login(server.port, ADMIN_EMAIL, requireAdminPassword());
    api = client(server.port, token);
    // A balance and a movement exist, so each list reaches its query (the
    // stock list filtered by category only once there is a balance).
    const location = (await api<{ id: string }>('POST', '/locations', { name: `IT filters ${run}`, type: 'RACK' })).body.id;
    const materialId = (await api<{ id: string }>('POST', '/materials', { sku: `IT-FLT-${run}`, name: `Filter item ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each' })).body.id;
    for (const quantity of [2, -2]) {
      const res = await api('POST', '/inventory-adjustments', { materialId, locationId: location, quantity, reasonCode: 'OTHER', reasonNote: 'Stock for the test' });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await server.close();
  });

  it.each(FILTERS)('%s?%s= refuses a value the enum does not have with a 400, not a 500', async (path, name) => {
    for (const bad of ['abc', 'consumables', "'; select 1;--"]) {
      const res = await api<{ error: { code: string; message: string; details: Record<string, string> } }>('GET', `${path}?${name}=${encodeURIComponent(bad)}`);
      expect(res.status, `${path}?${name}=${bad}`).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(new RegExp(`^${name} must be one of `));
      expect(res.body.error.details).toEqual({ [name]: bad });
    }
  });

  it.each(FILTERS)('%s?%s= still lists for a real value and for an empty one', async (path, name, good) => {
    for (const value of [good, '']) {
      // Not through client(): the exports answer with a spreadsheet, not JSON.
      const res = await fetch(`http://127.0.0.1:${server.port}/api/v1${path}?${name}=${value}`, { headers: { authorization: `Bearer ${token}` } });
      await res.arrayBuffer();
      expect(res.status, `${path}?${name}=${value}`).toBe(200);
    }
  });
});
