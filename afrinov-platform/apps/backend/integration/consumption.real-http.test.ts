// Real-HTTP + real-database tests for the consumption report: issues less
// returns per item, valued at unit price, by project, with reversed
// movements left out.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Item { sku: string; issued: number; returned: number; used: number; unitCost: number | null; value: number | null }
interface Report { from: string; to: string; items: Item[]; byProject: Array<{ projectNumber: string | null; value: number; items: number }>; total: { value: number } }

describe('consumption report over real HTTP', () => {
  const run = runId();
  const today = new Date().toISOString().slice(0, 10);
  const project = `IT-CONS-${run}`;
  const range = `from=${today}&to=${today}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  const sku = { disc: `IT-CONS-DISC-${run}`, pipe: `IT-CONS-PIPE-${run}` };

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const disc = await api<{ id: string }>('POST', '/materials', { sku: sku.disc, name: `Disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 42.05 });
    const pipe = await api<{ id: string }>('POST', '/materials', { sku: sku.pipe, name: `Pipe ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'm' });
    const loc = await api<{ id: string }>('POST', '/locations', { name: `IT consumption rack ${run}`, type: 'RACK' });
    expect((await api('POST', '/projects', { projectNumber: project, name: 'Consumption test' })).status).toBe(201);
    const rcp = await api<{ id: string }>('POST', '/recipients', { name: `IT consumption fitter ${run}`, type: 'WORKER' });
    for (const m of [disc.body.id, pipe.body.id]) {
      expect((await api('POST', '/inventory-adjustments', { materialId: m, locationId: loc.body.id, quantity: 100, reasonCode: 'OTHER' })).status).toBe(201);
    }
    const issue = async (materialId: string, quantity: number, projectNumber?: string) => {
      const r = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', { recipientId: rcp.body.id, projectNumber, lines: [{ materialId, locationId: loc.body.id, quantity }] });
      expect(r.status).toBe(201);
      return r.body.transactionIds[0]!;
    };
    // 30 discs to the project, 5 of them back; 10 discs with no project; 2.5 m of pipe to the project.
    const first = await issue(disc.body.id, 30, project);
    expect((await api('POST', `/inventory-transactions/${first}/returns`, { quantity: 5 })).status).toBe(201);
    await issue(disc.body.id, 10);
    await issue(pipe.body.id, 2.5, project);
    // A mistaken issue, reversed: it must not count.
    const mistake = await issue(disc.body.id, 7, project);
    expect((await api('POST', `/inventory-transactions/${mistake}/reversal`, { reason: 'Wrong item' })).status).toBe(201);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('nets returns off issues and leaves reversed issues out, valued at unit price', async () => {
    const res = await api<Report>('GET', `/reports/consumption?${range}`);
    expect(res.status).toBe(200);
    expect(res.body.items.find((i) => i.sku === sku.disc)).toEqual(expect.objectContaining({ issued: 40, returned: 5, used: 35, unitCost: 42.05, value: 1471.75 }));
    expect(res.body.items.find((i) => i.sku === sku.pipe)).toEqual(expect.objectContaining({ issued: 2.5, used: 2.5, unitCost: null, value: null }));
  });

  it('narrows to one project, or to issues with no project', async () => {
    const one = await api<Report>('GET', `/reports/consumption?${range}&projectNumber=${project}`);
    expect(one.body.items.map((i) => [i.sku, i.used, i.value])).toEqual([[sku.disc, 25, 1051.25], [sku.pipe, 2.5, null]]);
    expect(one.body.byProject).toEqual([{ projectNumber: project, projectName: 'Consumption test', value: 1051.25, items: 2 }]);
    expect(one.body.total.value).toBe(1051.25);

    const none = await api<Report>('GET', `/reports/consumption?${range}&projectNumber=__none__&category=CONSUMABLES`);
    expect(none.body.items.find((i) => i.sku === sku.disc)).toEqual(expect.objectContaining({ used: 10, value: 420.5 }));
    expect(none.body.items.some((i) => i.sku === sku.pipe)).toBe(false);
  });

  it('shows nothing for another period, and refuses a backwards range', async () => {
    const before = await api<Report>('GET', '/reports/consumption?from=2020-01-01&to=2020-01-31');
    expect(before.body.items.some((i) => i.sku === sku.disc)).toBe(false);
    expect((await api('GET', `/reports/consumption?from=${today}&to=2020-01-01`)).status).toBe(400);
  });

  it('downloads the same report as Excel', async () => {
    const res = await api<unknown>('GET', `/reports/consumption?${range}&projectNumber=${project}`);
    expect(res.status).toBe(200);
    const file = await fetch(`http://127.0.0.1:${server.port}/api/v1/reports/consumption/export?${range}&projectNumber=${project}`, {
      headers: { authorization: `Bearer ${await login(server.port, ADMIN_EMAIL, requireAdminPassword())}` },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain(`afrinov-consumption-${project}-${today}-to-${today}.xlsx`);
  });
});
