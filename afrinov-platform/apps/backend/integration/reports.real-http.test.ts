// Real-HTTP + real-database tests for reports and what their figures mean
// (system audit P5, ADR-041): a location counts the items it holds now (A4),
// waiting write-offs say how long they have waited and page (C8), an order's
// Activity pages without losing its first entries (D7), a Stores item goes on
// a project's issue (E4), a closed month keeps its figures (G1), and days and
// months are South African (G2).
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, letAdminSign, login, prisma, requireAdminPassword, runId, secondAdmin, startServer, type TestServer } from './helpers.js';
import { recomputeBalance, storesStock } from '../src/shared/inventory/balances.js';

type Failure = { error: { code: string; message: string } };
interface MonthEnd {
  month: string | null; valuedAt: 'CLOSED' | 'TODAY'; closed: { month: string; closedBy: string } | null;
  categories: Array<{ category: string; items: Array<{ sku: string; currentStock: number; value: number | null }>; used: Array<{ sku: string; used: number; value: number | null }> }>;
}
interface Consumption { items: Array<{ sku: string; used: number; value: number | null }> }

describe('P5 reports over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let checker: ReturnType<typeof client>;
  let adminId: string;
  let workerId: string;
  const settingsWere = new Map<string, unknown>();

  const rack = async (name: string) => (await api<{ id: string }>('POST', '/locations', { name: `${name} ${run}`, type: 'RACK' })).body.id;
  const item = async (sku: string, unitCost = 10, category = 'CONSUMABLES') => {
    const res = await api<{ id: string }>('POST', '/materials', { sku: `${sku}-${run}`, name: `${sku} ${run}`, category, unitOfMeasure: 'each', unitCost });
    expect(res.status).toBe(200);
    return res.body.id;
  };
  const found = async (materialId: string, locationId: string, quantity: number) =>
    expect((await api('POST', '/inventory-adjustments', { materialId, locationId, quantity, reasonCode: 'FOUND', reasonNote: 'P5 test stock' })).status).toBe(201);
  const setting = async (key: string, value: unknown) => {
    if (!settingsWere.has(key)) settingsWere.set(key, (await prisma.setting.findUniqueOrThrow({ where: { key } })).value);
    await prisma.setting.update({ where: { key }, data: { value: value as never } });
  };
  /**
   * A ledger line written straight to the database, to date it, with its
   * balance recomputed as every writer does: a line left without one is a
   * balance that differs from its ledger, which the daily stock check reports
   * (ADR-047), and the suites after this one share the database.
   */
  const dated = async (materialId: string, locationId: string, type: 'RECEIPT' | 'ISSUE', quantity: number, postedAt: string) => {
    const line = await prisma.inventoryTransaction.create({ data: { materialId, locationId, type, quantity, actorId: adminId, postedAt: new Date(postedAt) } });
    await recomputeBalance(storesStock(materialId, locationId), prisma);
    return line;
  };

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    await letAdminSign(api);
    checker = await secondAdmin(server.port, api, run);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id;
    workerId = (await api<{ id: string }>('POST', '/recipients', { name: `IT P5 fitter ${run}`, type: 'WORKER' })).body.id;
  });

  afterAll(async () => {
    for (const [key, value] of settingsWere) await prisma.setting.update({ where: { key }, data: { value: value as never } });
    await server?.close();
  });

  it('counts the items a location holds now, so an emptied rack shows none (A4)', async () => {
    const r = await rack('IT P5 rack');
    const [disc, glove] = [await item('IT-P5-DISC'), await item('IT-P5-GLOVE')];
    await found(disc, r, 3);
    await found(glove, r, 1);
    const counted = async () => (await api<Array<{ id: string; inventoryCount: number }>>('GET', '/locations')).body.find((l) => l.id === r)!.inventoryCount;
    expect(await counted()).toBe(2);
    const issued = await api('POST', '/inventory-issues', { recipientId: workerId, lines: [{ materialId: glove, locationId: r, quantity: 1 }] }, { 'idempotency-key': `p5-a4-${run}` });
    expect(issued.status).toBe(201);
    // The glove's balance row is still there at 0: it is not an item in stock.
    expect(await counted()).toBe(1);
    expect((await api<{ inventoryCount: number }>('GET', `/locations/${r}`)).body.inventoryCount).toBe(1);
  });

  it('says how long each write-off has waited, sums them up for the Dashboard, and pages the list (C8)', async () => {
    const r = await rack('IT P5 write-offs');
    const [cable, hose] = [await item('IT-P5-CABLE', 300), await item('IT-P5-HOSE', 200)];
    await setting('inventory.requireWriteOffApproval', false);
    await found(cable, r, 5);
    await found(hose, r, 5);
    await setting('inventory.requireWriteOffApproval', true);
    await setting('inventory.writeOffApprovalAbove', 0);
    const ask = async (materialId: string) => {
      const res = await api<{ requestId: string }>('POST', '/inventory-adjustments', { materialId, locationId: r, quantity: -1, reasonCode: 'LOSS', reasonNote: 'Missing' });
      expect(res.status).toBe(202);
      return res.body.requestId;
    };
    const older = await ask(cable);
    const newer = await ask(hose);
    await prisma.adjustmentRequest.update({ where: { id: older }, data: { requestedAt: new Date(Date.now() - 9 * 86_400_000) } });

    type Row = { id: string; daysWaiting: number; cursor: string };
    const all = (await api<Row[]>('GET', '/adjustment-requests')).body;
    expect(all.find((x) => x.id === newer)?.daysWaiting).toBe(0);
    expect(all.find((x) => x.id === older)?.daysWaiting).toBe(9);

    const summary = (await api<{ waiting: number; oldestDays: number | null }>('GET', '/adjustment-requests/summary')).body;
    expect(summary.waiting).toBeGreaterThanOrEqual(2);
    expect(summary.oldestDays).toBeGreaterThanOrEqual(9);

    // One at a time: the next page starts after the last row's cursor, with no row twice.
    const first = (await api<Row[]>('GET', '/adjustment-requests?limit=1')).body;
    expect(first).toHaveLength(1);
    const second = (await api<Row[]>('GET', `/adjustment-requests?limit=1&before=${encodeURIComponent(first[0]!.cursor)}`)).body;
    expect(second).toHaveLength(1);
    expect(second[0]!.id).not.toBe(first[0]!.id);
    expect(all.map((x) => x.id).slice(0, 2)).toEqual([first[0]!.id, second[0]!.id]);

    for (const id of [older, newer]) expect((await checker('POST', `/adjustment-requests/${id}/reject`, { reason: 'P5 test over' })).status).toBe(200);
    // Put approval back as the other tests expect it.
    for (const key of ['inventory.requireWriteOffApproval', 'inventory.writeOffApprovalAbove']) await setting(key, settingsWere.get(key));
  });

  it('pages an order\'s Activity on request, and returns all of it otherwise, first entries included (D7)', async () => {
    const supplierId = (await api<{ id: string }>('POST', '/suppliers', { name: `IT P5 supplier ${run}` })).body.id;
    const bolt = await item('IT-P5-BOLT');
    const order = await api<{ id: string }>('POST', '/purchase-orders', { supplierId, lines: [{ materialId: bolt, orderedQty: 4, unitPrice: 10 }] });
    expect(order.status).toBe(201);
    for (const notes of ['First note', 'Second note', 'Third note']) expect((await api('PATCH', `/purchase-orders/${order.body.id}`, { notes })).status).toBe(200);

    type Entry = { id: string; action: string; cursor: string };
    const all = (await api<Entry[]>('GET', `/purchase-orders/${order.body.id}/history`)).body;
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.at(-1)).toMatchObject({ action: 'CREATE' });

    const page = (await api<Entry[]>('GET', `/purchase-orders/${order.body.id}/history?limit=2`)).body;
    expect(page.map((e) => e.id)).toEqual(all.slice(0, 2).map((e) => e.id));
    const older = (await api<Entry[]>('GET', `/purchase-orders/${order.body.id}/history?limit=500&before=${encodeURIComponent(page[1]!.cursor)}`)).body;
    expect(older.map((e) => e.id)).toEqual(all.slice(2).map((e) => e.id));
    expect((await api<Failure>('GET', `/purchase-orders/${order.body.id}/history?limit=0`)).status).toBe(400);
  });

  // ADR-043 reverses E4: Stores stock has nothing to do with projects.
  it('keeps Stores stock off a project\'s issue (ADR-043)', async () => {
    const job = `IT-P5-JOB-${run}`;
    expect((await api('POST', '/projects', { projectNumber: job, name: `P5 job ${run}`, status: 'ACTIVE' })).status).toBe(201);
    const r = await rack('IT P5 stores');
    const tape = await item('IT-P5-TAPE');
    await found(tape, r, 4);
    const before = await prisma.inventoryTransaction.count({ where: { materialId: tape } });
    const direct = await api<{ error: { code: string } }>('POST', '/inventory-issues', {
      recipientId: workerId, projectNumber: job, lines: [{ materialId: tape, locationId: r, quantity: 2 }],
    }, { 'idempotency-key': `p5-e4-${run}` });
    expect(direct.status).toBe(400);
    // Asked for approval, it finds nothing held for the job.
    const asked = await api<Failure>('POST', '/issue-requests', { recipientId: workerId, projectNumber: job, lines: [{ materialId: tape, locationId: r, quantity: 2 }] });
    expect([asked.status, asked.body.error.code]).toEqual([422, 'INSUFFICIENT_BALANCE']);
    expect(await prisma.inventoryTransaction.count({ where: { materialId: tape } })).toBe(before);
  });

  it('keeps a closed month\'s figures through a price change, values its stock used at the kept prices, and opens it again only with a reason (G1)', async () => {
    const month = '2024-03';
    const r = await rack('IT P5 closed month');
    const pump = await item('IT-P5-PUMP', 100);
    const sku = `IT-P5-PUMP-${run}`;
    await dated(pump, r, 'RECEIPT', 10, '2024-03-05T08:00:00Z');
    await dated(pump, r, 'ISSUE', -4, '2024-03-20T08:00:00Z');
    const report = async () => (await api<MonthEnd>('GET', `/reports/month-end?month=${month}`)).body;
    const pumpIn = (m: MonthEnd) => m.categories.find((c) => c.category === 'CONSUMABLES')?.items.find((i) => i.sku === sku);
    const used = async () => (await api<Consumption>('GET', `/reports/consumption?from=${month}-01&to=${month}-31`)).body.items.find((i) => i.sku === sku);

    const open = await report();
    expect([open.valuedAt, open.closed]).toEqual(['TODAY', null]);
    expect(pumpIn(open)).toMatchObject({ currentStock: 6, value: 600 });

    // Only an Admin's manage:settings closes a month; this one is long over.
    const closed = await api<{ month: string; closedBy: string }>('POST', '/month-closes', { month });
    expect(closed.status).toBe(201);
    expect(closed.body.month).toBe(month);
    expect((await api<Failure>('POST', '/month-closes', { month })).status).toBe(409);
    expect((await api<Array<{ month: string }>>('GET', '/month-closes')).body.some((c) => c.month === month)).toBe(true);

    expect((await api('PATCH', `/materials/${pump}`, { unitCost: 250, unitCostReason: 'New supplier price' })).status).toBe(200);
    const kept = await report();
    expect([kept.valuedAt, kept.closed?.month]).toEqual(['CLOSED', month]);
    expect(pumpIn(kept)).toMatchObject({ currentStock: 6, value: 600 });
    expect(await used()).toMatchObject({ used: 4, value: 400 });

    expect((await api<Failure>('POST', `/month-closes/${month}/reopen`, { reason: ' ' })).status).toBe(400);
    expect((await api('POST', `/month-closes/${month}/reopen`, { reason: 'P5 test: prices corrected' })).status).toBe(200);
    const reopened = await report();
    expect(reopened.valuedAt).toBe('TODAY');
    expect(pumpIn(reopened)).toMatchObject({ value: 1500 });
    expect(await used()).toMatchObject({ value: 1000 });
    expect(await prisma.auditLogEntry.count({ where: { entityId: month, action: { in: ['MONTH_CLOSE', 'MONTH_REOPEN'] } } })).toBeGreaterThanOrEqual(2);
  });

  it('refuses to close a month that is not over, or that is malformed (G1)', async () => {
    const thisMonth = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 7);
    expect((await api<Failure>('POST', '/month-closes', { month: thisMonth })).status).toBe(400);
    expect((await api<Failure>('POST', '/month-closes', { month: '2024-13' })).status).toBe(400);
    expect((await api<Failure>('POST', '/month-closes/2019-01/reopen', { reason: 'Never closed' })).status).toBe(404);
  });

  it('puts half past midnight on the 1st, South African time, in the new month (G2)', async () => {
    const r = await rack('IT P5 midnight');
    const nut = await item('IT-P5-NUT', 5);
    const sku = `IT-P5-NUT-${run}`;
    await dated(nut, r, 'RECEIPT', 10, '2024-04-30T20:00:00Z');
    // 22:30 UTC on 30 April is 00:30 on 1 May in South Africa.
    await dated(nut, r, 'ISSUE', -3, '2024-04-30T22:30:00Z');
    const usedIn = async (from: string, to: string) => (await api<Consumption>('GET', `/reports/consumption?from=${from}&to=${to}`)).body.items.find((i) => i.sku === sku);
    expect(await usedIn('2024-04-01', '2024-04-30')).toBeUndefined();
    expect(await usedIn('2024-05-01', '2024-05-01')).toMatchObject({ used: 3 });
    const april = (await api<MonthEnd>('GET', '/reports/month-end?month=2024-04')).body;
    expect(april.categories.find((c) => c.category === 'CONSUMABLES')?.items.find((i) => i.sku === sku)).toMatchObject({ currentStock: 10 });
  });
});
