// Real-HTTP + real-database tests for the "Issued To" list: recipients are
// unique by name, are deactivated rather than deleted, and an issue records
// who received the stock.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Recipient { id: string; name: string; type: string; active: boolean }
interface HistoryRow { id: string; type: string; recipientId: string | null; recipientName: string | null }

describe('recipients over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let locationId: string;
  let worker: Recipient;

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));

    const material = await api<{ id: string }>('POST', '/materials', {
      sku: `IT-RCP-${run}`, name: `Integration disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each',
    });
    expect(material.status).toBe(200);
    materialId = material.body.id;
    const location = await api<{ id: string }>('POST', '/locations', { name: `IT rack ${run}`, type: 'RACK' });
    expect(location.status).toBe(201);
    locationId = location.body.id;
    const stocked = await api('POST', '/inventory-adjustments', { materialId, locationId, quantity: 10, reasonCode: 'COUNT_VARIANCE' });
    expect(stocked.status).toBe(201);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('adds recipients of each type and refuses a duplicate name', async () => {
    const created = await api<Recipient>('POST', '/recipients', { name: `Worker ${run}`, type: 'WORKER' });
    expect(created.status).toBe(201);
    worker = created.body;
    for (const type of ['MACHINE', 'SITE', 'CONTRACTOR']) {
      expect((await api('POST', '/recipients', { name: `${type} ${run}`, type })).status).toBe(201);
    }

    const duplicate = await api('POST', '/recipients', { name: `  WORKER ${run} `, type: 'CONTRACTOR' });
    expect(duplicate.status).toBe(409);

    const machines = await api<Recipient[]>('GET', `/recipients?type=MACHINE&q=${run}`);
    expect(machines.body.map((r) => r.name)).toEqual([`MACHINE ${run}`]);
  });

  it('records the recipient on an issue and shows the name in the history', async () => {
    const issued = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', {
      recipientId: worker.id, lines: [{ materialId, locationId, quantity: 3 }],
    });
    expect(issued.status).toBe(201);

    const history = await api<HistoryRow[]>('GET', `/inventory-transactions?materialId=${materialId}`);
    const row = history.body.find((t) => t.id === issued.body.transactionIds[0])!;
    expect(row).toMatchObject({ type: 'ISSUE', recipientId: worker.id, recipientName: `Worker ${run}` });
  });

  it('refuses issuing to a deactivated recipient and keeps it on past issues', async () => {
    const deactivated = await api<Recipient>('PATCH', `/recipients/${worker.id}`, { active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);

    const before = await prisma.inventoryTransaction.count({ where: { materialId } });
    const refused = await api('POST', '/inventory-issues', { recipientId: worker.id, lines: [{ materialId, locationId, quantity: 1 }] });
    expect(refused.status).toBe(400);
    expect(await prisma.inventoryTransaction.count({ where: { materialId } })).toBe(before);

    const history = await api<HistoryRow[]>('GET', `/inventory-transactions?materialId=${materialId}`);
    expect(history.body.some((t) => t.recipientName === `Worker ${run}`)).toBe(true);
  });

  it('lets a viewer read the list but not change it', async () => {
    const email = `it-rcp-viewer-${run}@example.com`;
    const password = `viewer-${run}-pass`;
    expect((await api('POST', '/users', { email, name: `IT viewer ${run}`, password, roleNames: ['VIEWER'] })).status).toBe(201);
    const viewer = client(server.port, await login(server.port, email, password));

    expect((await viewer('GET', '/recipients')).status).toBe(200);
    expect((await viewer('POST', '/recipients', { name: `Nope ${run}`, type: 'WORKER' })).status).toBe(403);
    expect((await viewer('PATCH', `/recipients/${worker.id}`, { active: true })).status).toBe(403);
  });
});
