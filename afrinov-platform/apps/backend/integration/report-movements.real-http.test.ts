// Real-HTTP + real-database tests for the movements in the inventory report: an
// item's history stays when the item is deactivated, and a filter that matches
// no item lists nothing.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';
import type { ReportResult } from '../src/modules/reporting/report.service.js';

describe('inventory report movements over real HTTP', () => {
  const run = runId();
  const sku = `IT-REP-${run}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;

  const report = async (query: string) => {
    const res = await api<ReportResult>('GET', `/reports/inventory?range=ALL&${query}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const ofItem = (r: ReportResult) => r.movements.filter((m) => m.materialSku === sku);

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const location = (await api<{ id: string }>('POST', '/locations', { name: `IT report ${run}`, type: 'RACK' })).body.id;
    materialId = (await api<{ id: string }>('POST', '/materials', { sku, name: `Report item ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each' })).body.id;
    for (const quantity of [4, -4]) {
      const res = await api('POST', '/inventory-adjustments', { materialId, locationId: location, quantity, reasonCode: 'OTHER', reasonNote: 'Stock for the test' });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await server.close();
  });

  it('keeps an item\'s movements after it is deactivated, whatever the item status filter', async () => {
    expect(ofItem(await report('search=' + sku))).toHaveLength(2);
    expect((await api('PATCH', `/materials/${materialId}/status`, { active: false, reasonCode: 'OBSOLETE' })).status).toBe(200);

    const active = await report(`search=${sku}&itemStatus=ACTIVE`);
    expect(active.inventory).toEqual([]);
    expect(ofItem(active)).toHaveLength(2);
    expect(active.kpis.movementCount).toBe(2);
    expect(active.movementSummary.adjustments).toEqual({ count: 2, quantity: 8 });
    expect(ofItem(await report('search=' + sku))).toHaveLength(2);
  });

  it('lists no movements when the filters match no item', async () => {
    const r = await report(`search=no-such-item-${run}`);
    expect(r.movements).toEqual([]);
    expect(r.kpis.movementCount).toBe(0);
    expect(r.movementSummary.total).toEqual({ count: 0, quantity: 0 });
  });

  it('counts every movement in the totals when no filter is set', async () => {
    const r = await report('itemStatus=ALL');
    expect(r.kpis.movementCount).toBeGreaterThanOrEqual(r.movements.length);
  });
});
