// Real-database tests for the month-end report: stock as it stood at the end
// of the month, rebuilt from the ledger, so later movements do not change a
// past month; and the stock used in that month.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Item { sku: string; location: string; requiredStock: number; currentStock: number; value: number | null; percentOfRequired: number | null; reorderQuantity: number | null; status: string }
interface Report { month: string; categories: Array<{ category: string; items: Item[]; used: Array<{ sku: string; used: number }> }> }

describe('month-end report against a real database', () => {
  const run = runId();
  const sku = `IT-ME-${run}`;
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonth = lastMonthStart.toISOString().slice(0, 7);
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let token: string;

  const item = (r: Report) => r.categories.find((c) => c.category === 'CONSUMABLES')?.items.find((i) => i.sku === sku);

  beforeAll(async () => {
    server = await startServer();
    token = await login(server.port, ADMIN_EMAIL, requireAdminPassword());
    api = client(server.port, token);
    const m = await api<{ id: string }>('POST', '/materials', { sku, name: `Month-end disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: 100, unitCost: 10 });
    const loc = await api<{ id: string }>('POST', '/locations', { name: `IT month-end rack ${run}`, type: 'RACK' });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    // 15 received in the middle of last month (written straight to the ledger to date it).
    await prisma.inventoryTransaction.create({
      data: { materialId: m.body.id, locationId: loc.body.id, type: 'RECEIPT', quantity: 15, actorId: admin.id, postedAt: new Date(lastMonthStart.getTime() + 14 * 86400000) },
    });
    // 85 more this month.
    expect((await api('POST', '/inventory-adjustments', { materialId: m.body.id, locationId: loc.body.id, quantity: 85, reasonCode: 'OTHER' })).status).toBe(201);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('shows last month as it stood then, not as it is now', async () => {
    const last = await api<Report>('GET', `/reports/month-end?month=${lastMonth}`);
    expect(last.status).toBe(200);
    expect(item(last.body)).toEqual(expect.objectContaining({
      location: `IT month-end rack ${run}`, requiredStock: 100, currentStock: 15, value: 150,
      percentOfRequired: 0.15, reorderQuantity: 85, status: 'URGENT',
    }));

    const current = await api<Report>('GET', `/reports/month-end?month=${thisMonth}`);
    expect(item(current.body)).toEqual(expect.objectContaining({ currentStock: 100, percentOfRequired: 1, reorderQuantity: 0, status: 'OK' }));
  });

  it('refuses a month that has not started', async () => {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    expect((await api('GET', `/reports/month-end?month=${next}`)).status).toBe(400);
  });

  it('downloads the month as Excel in the workbook layout', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/reports/month-end/export?month=${lastMonth}`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(`afrinov-month-end-${lastMonth}.xlsx`);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
