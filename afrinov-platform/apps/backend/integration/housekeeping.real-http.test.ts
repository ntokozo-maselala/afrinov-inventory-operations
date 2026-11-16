// Real-HTTP + real-database tests for housekeeping (system audit P6, ADR-042):
// creating a supplier, order or RFQ is retry-safe (D5), a draft can always be
// cancelled (D6), an exchange rate says how old it is (D8), signing out ends
// the sign-in on the server (F7), and manage:roles is gone (F8).
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

type Failure = { error: { code: string; message: string } };

describe('P6 housekeeping over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  const settingsWere = new Map<string, unknown>();
  const setting = async (key: string, value: unknown) => {
    if (!settingsWere.has(key)) settingsWere.set(key, (await prisma.setting.findUniqueOrThrow({ where: { key } })).value);
    await prisma.setting.update({ where: { key }, data: { value: value as never } });
  };

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    materialId = (await api<{ id: string }>('POST', '/materials', { sku: `IT-P6-${run}`, name: `P6 disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 10 })).body.id;
  });

  afterAll(async () => {
    for (const [key, value] of settingsWere) await prisma.setting.update({ where: { key }, data: { value: value as never } });
    await server?.close();
  });

  describe('a retried create returns the first record (D5)', () => {
    it('makes one supplier however often the same request is sent', async () => {
      const body = { name: `IT P6 retried supplier ${run}` };
      const key = { 'idempotency-key': `p6-sup-${run}` };
      const first = await api<{ id: string }>('POST', '/suppliers', body, key);
      const again = await api<{ id: string }>('POST', '/suppliers', body, key);
      expect([first.status, again.status]).toEqual([201, 201]);
      expect(again.body.id).toBe(first.body.id);
      expect(await prisma.supplier.count({ where: { name: body.name } })).toBe(1);
      // The same key for different details is refused, not a second supplier.
      const reused = await api<Failure>('POST', '/suppliers', { name: `IT P6 other ${run}` }, key);
      expect([reused.status, reused.body.error.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    });

    it('makes one draft order, and one RFQ', async () => {
      const supplierId = (await api<{ id: string }>('POST', '/suppliers', { name: `IT P6 supplier ${run}` })).body.id;
      const order = { supplierId, lines: [{ materialId, orderedQty: 3, unitPrice: 10 }] };
      const okey = { 'idempotency-key': `p6-po-${run}` };
      const po1 = await api<{ id: string }>('POST', '/purchase-orders', order, okey);
      const po2 = await api<{ id: string }>('POST', '/purchase-orders', order, okey);
      expect([po1.status, po2.status]).toEqual([201, 201]);
      expect(po2.body.id).toBe(po1.body.id);
      expect(await prisma.purchaseOrder.count({ where: { supplierId } })).toBe(1);

      const job = `IT-P6-JOB-${run}`;
      expect((await api('POST', '/projects', { projectNumber: job, name: `P6 job ${run}` })).status).toBe(201);
      const pipe = (await api<{ id: string }>('POST', '/materials', { sku: `IT-P6-PIPE-${run}`, name: `P6 pipe ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'each', projectNumber: job })).body.id;
      const rfq = { projectNumber: job, lines: [{ materialId: pipe, quantity: 4 }], supplierIds: [supplierId] };
      const rkey = { 'idempotency-key': `p6-rfq-${run}` };
      const r1 = await api<{ id: string; number: string }>('POST', '/rfqs', rfq, rkey);
      const r2 = await api<{ id: string; number: string }>('POST', '/rfqs', rfq, rkey);
      expect([r1.status, r2.status]).toEqual([201, 201]);
      expect(r2.body).toMatchObject({ id: r1.body.id, number: r1.body.number });
      expect(await prisma.rfq.count({ where: { projectNumber: job } })).toBe(1);
    });
  });

  it('cancels a draft with cancelling switched off, but not a submitted order (D6)', async () => {
    const supplierId = (await api<{ id: string }>('POST', '/suppliers', { name: `IT P6 cancel supplier ${run}` })).body.id;
    const order = { supplierId, lines: [{ materialId, orderedQty: 1, unitPrice: 10 }] };
    const draft = (await api<{ id: string }>('POST', '/purchase-orders', order)).body.id;
    const submitted = (await api<{ id: string }>('POST', '/purchase-orders', order)).body.id;
    expect((await api('POST', `/purchase-orders/${submitted}/submit`)).status).toBe(200);
    await setting('purchaseOrders.allowCancellation', false);
    const refused = await api<Failure>('POST', `/purchase-orders/${submitted}/cancel`, { reason: 'Not needed' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/A draft can still be cancelled/);
    const cleared = await api<{ status: string }>('POST', `/purchase-orders/${draft}/cancel`, { reason: 'Started by mistake' });
    expect([cleared.status, cleared.body.status]).toEqual([200, 'CANCELLED']);
    await setting('purchaseOrders.allowCancellation', true);
  });

  it('says when a draft\'s exchange rate was last changed, and calls one over 30 days old stale (D8)', async () => {
    const key = 'purchaseOrders.exchangeRateEUR';
    const wasRow = await prisma.setting.findUniqueOrThrow({ where: { key } });
    try {
      await prisma.setting.update({ where: { key }, data: { value: 20 as never, updatedAt: new Date(Date.now() - 40 * 86_400_000) } });
      const eur = (await api<{ id: string }>('POST', '/suppliers', { name: `IT P6 EUR ${run}`, currency: 'EUR' })).body.id;
      const order = (await api<{ id: string }>('POST', '/purchase-orders', { supplierId: eur, lines: [{ materialId, orderedQty: 1, unitPrice: 10 }] })).body.id;
      type View = { rate: { setAt: string; days: number; stale: boolean } | null };
      const stale = (await api<View>('GET', `/purchase-orders/${order}/approval`)).body;
      expect(stale.rate).toMatchObject({ days: 40, stale: true });
      await prisma.setting.update({ where: { key }, data: { updatedAt: new Date() } });
      expect((await api<View>('GET', `/purchase-orders/${order}/approval`)).body.rate).toMatchObject({ days: 0, stale: false });
    } finally {
      await prisma.setting.update({ where: { key }, data: { value: wasRow.value as never, updatedAt: wasRow.updatedAt } });
    }
  });

  it('refuses a token once its sign-in has signed out, and lets a new sign-in work (F7)', async () => {
    const email = `it-p6-signout-${run}@afrinov.local`;
    const password = `It-P6-${run}-Sign-out-9`;
    expect((await api('POST', '/users', { email, name: `IT P6 ${run}`, password, roleNames: ['VIEWER'], mustChangePassword: false })).status).toBe(201);
    const token = await login(server.port, email, password);
    const as = client(server.port, token);
    expect((await as('GET', '/auth/me')).status).toBe(200);
    expect((await as('POST', '/auth/logout')).status).toBe(204);
    const after = await as<Failure>('GET', '/auth/me');
    expect([after.status, after.body.error.message]).toEqual([401, 'You signed out. Sign in again.']);
    expect((await as('POST', '/auth/refresh')).status).toBe(401);
    // A second later, a new sign-in is after the cut-off.
    await new Promise((r) => setTimeout(r, 1100));
    const fresh = client(server.port, await login(server.port, email, password));
    expect((await fresh('GET', '/auth/me')).status).toBe(200);
  });

  it('has no manage:roles permission any more (F8)', async () => {
    expect(await prisma.permission.count({ where: { code: 'manage:roles' } })).toBe(0);
    const me = await api<{ permissions: string[] }>('GET', '/auth/me');
    expect(me.body.permissions).not.toContain('manage:roles');
    expect(me.body.permissions).toContain('manage:users');
  });
});
