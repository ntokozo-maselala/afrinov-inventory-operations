// Real-HTTP + real-database tests for the controls of system audit P3 (ADR-039):
// who prices an item and why (C1, C3), write-offs added up over a week (C2),
// who closes a project (E3), the sign-in log (F3), slips issued to oneself
// (F5), who reads who lost what (F6), switching off a two-person check (C9) and
// resetting one settings section (C10). The retired receive-all and stock-items
// routes (D3) are covered in procurement.real-http and materials-sections.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

type Failure = { error: { code: string; message: string } };

describe('P3 controls over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let admin: ReturnType<typeof client>;
  let store: ReturnType<typeof client>;
  let sales: ReturnType<typeof client>;
  let tech: ReturnType<typeof client>;
  let storeId: string;
  let storeEmail: string;
  let salesId: string;
  let locationId: string;
  let supplierId: string;

  /** A user of the run with these roles, signed in. */
  async function user(role: string): Promise<{ id: string; email: string; call: ReturnType<typeof client> }> {
    const email = `it-p3-${role.toLowerCase()}-${run}@afrinov.local`;
    const password = `It-${run}-${role}`;
    const made = await admin<{ id: string }>('POST', '/users', { email, name: `IT ${role} ${run}`, password, roleNames: [role], mustChangePassword: false });
    expect(made.status).toBe(201);
    return { id: made.body.id, email, call: client(server.port, await login(server.port, email, password)) };
  }

  const item = async (sku: string, unitCost?: number) => {
    const res = await admin<{ id: string }>('POST', '/materials', { sku: `${sku}-${run}`, name: `${sku} ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', ...(unitCost !== undefined ? { unitCost } : {}) });
    expect(res.status).toBe(200);
    return res.body.id;
  };
  const receive = async (materialId: string, quantity: number) =>
    expect((await admin('POST', '/stock-receipts', { supplierId, deliveryRef: `IT-P3-${materialId.slice(0, 6)}`, lines: [{ materialId, locationId, quantity }] })).status).toBe(201);

  beforeAll(async () => {
    // Counter receipts, to put stock on the shelf without an order.
    server = await startServer({ procurementEnabled: false });
    // startServer leaves write-off approval off for the other suites: on here, at R 1 000.
    await prisma.setting.update({ where: { key: 'inventory.requireWriteOffApproval' }, data: { value: true } });
    await prisma.setting.update({ where: { key: 'inventory.writeOffApprovalAbove' }, data: { value: 1000 } });
    admin = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const s = await user('STORE_CONTROLLER');
    [store, storeId, storeEmail] = [s.call, s.id, s.email];
    const sl = await user('SALES');
    [sales, salesId] = [sl.call, sl.id];
    tech = (await user('TECHNICIAN')).call;
    locationId = (await admin<{ id: string }>('POST', '/locations', { name: `IT P3 rack ${run}`, type: 'RACK' })).body.id;
    supplierId = (await admin<{ id: string }>('POST', '/suppliers', { name: `IT P3 supplier ${run}` })).body.id;
  });

  afterAll(async () => {
    // Settings are shared by every suite: leave both checks on.
    await admin('PATCH', '/settings', { updates: { 'inventory.requireWriteOffApproval': true, 'purchaseOrders.requireApprovalBeforeProcessing': true } });
    await server?.close();
  });

  it('leaves the unit cost to Procurement and Admin, and keeps why each change was made (C1, C3)', async () => {
    const plain = await store<Failure>('POST', '/materials', { sku: `IT-P3-SC-${run}`, name: 'Priced by the store', category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 5 });
    expect(plain.status).toBe(403);
    const disc = await item('IT-P3-DISC', 12);
    expect((await store('PATCH', `/materials/${disc}`, { unitCost: 0.01, unitCostReason: 'Cheaper' })).status).toBe(403);
    // The store still edits the rest of the item.
    expect((await store('PATCH', `/materials/${disc}`, { description: 'Thin cutting disc' })).status).toBe(200);

    const noReason = await admin<Failure>('PATCH', `/materials/${disc}`, { unitCost: 15 });
    expect(noReason.status).toBe(400);
    expect((await admin('PATCH', `/materials/${disc}`, { unitCost: 15, unitCostReason: 'New quote from the supplier' })).status).toBe(200);
    const history = await admin<Array<{ before: string | null; after: string | null; reason: string }>>('GET', `/materials/${disc}/cost-history`);
    expect(history.body.map((h) => [h.before && Number(h.before), h.after && Number(h.after), h.reason]))
      .toEqual([[12, 15, 'New quote from the supplier'], [null, 12, 'Set when the item was added']]);
  });

  it('adds up one person\'s write-offs of an item over a week, so a large one can\'t be split (C2)', async () => {
    const plate = await item('IT-P3-PLATE', 100);
    await receive(plate, 20);
    // R 600: under the limit, it posts.
    expect((await store('POST', '/inventory-adjustments', { materialId: plate, locationId, quantity: -6, reasonCode: 'DAMAGE' })).status).toBe(201);
    // Another R 600 the same week: R 1 200 together, so it waits.
    const second = await store<{ status: string; recentValue?: string }>('POST', '/inventory-adjustments', { materialId: plate, locationId, quantity: -6, reasonCode: 'DAMAGE' });
    expect(second.status).toBe(202);
    expect(second.body).toMatchObject({ status: 'PENDING_APPROVAL', recentValue: '600.00' });
  });

  it('lets only an Admin or the project\'s manager complete or hand on a project (E3)', async () => {
    const job = `IT-P3-${run}`;
    expect((await admin('POST', '/projects', { projectNumber: job, name: `P3 job ${run}`, status: 'ACTIVE', managerId: storeId })).status).toBe(201);
    // Sales edits it, but neither closes it nor makes itself its manager.
    expect((await sales('PATCH', `/projects/${job}`, { notes: 'Client called' })).status).toBe(200);
    expect((await sales<Failure>('PATCH', `/projects/${job}`, { status: 'CANCELLED' })).status).toBe(403);
    expect((await sales<Failure>('DELETE', `/projects/${job}`)).status).toBe(403);
    expect((await sales<Failure>('PATCH', `/projects/${job}`, { managerId: salesId })).status).toBe(403);
    expect(await prisma.project.findUniqueOrThrow({ where: { projectNumber: job } })).toMatchObject({ status: 'ACTIVE', managerId: storeId });
    // Its manager closes it.
    expect((await store<{ status: string }>('PATCH', `/projects/${job}`, { status: 'COMPLETED' })).body.status).toBe('COMPLETED');
  });

  it('keeps a sign-in log for Admins: sign-ins, wrong passwords and sign-outs (F3)', async () => {
    expect((await client(server.port)('POST', '/auth/login', { email: storeEmail, password: 'not-the-password' })).status).toBe(401);
    expect((await store('POST', '/auth/logout')).status).toBe(204);
    const log = await admin<{ total: number; items: Array<{ outcome: string; user: { id: string } | null; ip: string | null }> }>('GET', `/sign-ins?email=${encodeURIComponent(storeEmail)}`);
    expect(log.status).toBe(200);
    expect(log.body.items.map((i) => i.outcome)).toEqual(['SIGN_OUT', 'FAILED', 'SIGN_IN']);
    expect(log.body.items.every((i) => i.user?.id === storeId && !!i.ip)).toBe(true);
    expect((await store('GET', '/sign-ins')).status).toBe(403);
    expect((await admin('GET', '/sign-ins?outcome=MAYBE')).status).toBe(400);
  });

  it('links a recipient to its user account and shows a slip issued to oneself (F5)', async () => {
    const me = await admin<{ id: string; userId: string }>('POST', '/recipients', { name: `IT P3 storeman ${run}`, type: 'WORKER', userId: storeId });
    expect(me.status).toBe(201);
    expect(me.body.userId).toBe(storeId);
    expect((await admin('POST', '/recipients', { name: `IT P3 twin ${run}`, type: 'WORKER', userId: storeId })).status).toBe(409);
    expect((await admin('POST', '/recipients', { name: `IT P3 forklift ${run}`, type: 'MACHINE', userId: salesId })).status).toBe(400);

    const gloves = await item('IT-P3-GLOVE', 30);
    await receive(gloves, 5);
    // Somebody else's issue to them isn't flagged; their own is.
    const byAdmin = await admin<{ issueId: string }>('POST', '/inventory-issues', { recipientId: me.body.id, lines: [{ materialId: gloves, locationId, quantity: 1 }] });
    const byThemselves = await store<{ issueId: string }>('POST', '/inventory-issues', { recipientId: me.body.id, lines: [{ materialId: gloves, locationId, quantity: 2 }] });
    expect(byThemselves.status).toBe(201);
    const flagged = await admin<{ slips: Array<{ issueId: string; by: { id: string }; lines: number }> }>('GET', '/reports/self-issued');
    const ids = flagged.body.slips.map((x) => x.issueId);
    expect(ids).toContain(byThemselves.body.issueId);
    expect(ids).not.toContain(byAdmin.body.issueId);
    expect(flagged.body.slips.find((x) => x.issueId === byThemselves.body.issueId)).toMatchObject({ by: { id: storeId }, lines: 1 });
    expect((await tech('GET', '/reports/self-issued')).status).toBe(403);
  });

  it('shows who was responsible for losses only to those who adjust or approve write-offs (F6)', async () => {
    expect((await tech('GET', '/inventory-transactions/writeoffs-by-responsible')).status).toBe(403);
    expect((await store('GET', '/inventory-transactions/writeoffs-by-responsible')).status).toBe(200);
    // The ledger itself is a report: every role holds view:reports today.
    expect((await tech('GET', '/inventory-transactions?limit=1')).status).toBe(200);
  });

  it('asks why when a two-person check is switched off, and keeps it in Activity (C9)', async () => {
    const off = (reason?: string) => admin<Failure>('PUT', '/settings/inventory.requireWriteOffApproval', { value: false, ...(reason ? { reason } : {}) });
    expect((await off()).status).toBe(400);
    expect((await admin('PATCH', '/settings', { updates: { 'purchaseOrders.requireApprovalBeforeProcessing': false } })).status).toBe(400);
    expect((await off(`Stock take weekend ${run}`)).status).toBe(200);
    const entry = await prisma.auditLogEntry.findFirst({ where: { entityType: 'Setting', entityId: 'inventory.requireWriteOffApproval' }, orderBy: { createdAt: 'desc' } });
    expect(entry?.after).toMatchObject({ value: false, reason: `Stock take weekend ${run}` });
    expect((await admin('PUT', '/settings/inventory.requireWriteOffApproval', { value: true })).status).toBe(200);
  });

  it('resets one settings section after a preview, leaving the others (C10)', async () => {
    expect((await admin('PUT', '/settings/general.companyName', { value: `Afrinov ${run}` })).status).toBe(200);
    expect((await admin('PUT', '/settings/inventory.toolOverdueDays', { value: 9 })).status).toBe(200);
    const preview = await admin<Array<{ key: string; from: unknown; to: unknown }>>('GET', '/settings/reset-preview?category=general');
    expect(preview.body).toContainEqual(expect.objectContaining({ key: 'general.companyName', from: `Afrinov ${run}` }));
    expect(preview.body.some((c) => c.key.startsWith('inventory.'))).toBe(false);
    expect((await admin('POST', '/settings/reset', {})).status).toBe(400);
    expect((await admin('POST', '/settings/reset', { category: 'general' })).status).toBe(200);
    expect((await admin<{ value: unknown }>('GET', '/settings/general.companyName')).body.value).not.toBe(`Afrinov ${run}`);
    expect((await admin<{ value: unknown }>('GET', '/settings/inventory.toolOverdueDays')).body.value).toBe(9);
    expect((await admin('PUT', '/settings/inventory.toolOverdueDays', { value: 7 })).status).toBe(200);
  });
});
