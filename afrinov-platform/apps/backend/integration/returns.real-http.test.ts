// Real-HTTP + real-database tests for returning unused stock from an issue:
// it goes back on the shelf, reduces the project's consumption, can never
// exceed what was issued, and keeps the ledger consistent with reversals.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Consumption { materialId: string; total: number }
interface HistoryRow { id: string; type: string; returnedQuantity: string | null }

describe('returns over real HTTP', () => {
  const run = runId();
  const projectNumber = `IT-RET-${run}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let rackId: string;
  let issueId: string;

  async function onHand(): Promise<string> {
    const { ledger, balance } = await ledgerAndBalance(materialId, rackId);
    expect(balance).toBe(ledger);
    return ledger;
  }

  async function consumed(): Promise<number> {
    const res = await api<Consumption[]>('GET', `/reports/project-consumption/${projectNumber}`);
    expect(res.status).toBe(200);
    return res.body.find((r) => r.materialId === materialId)?.total ?? 0;
  }

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));

    const m = await api<{ id: string }>('POST', '/materials', { sku: `IT-RET-${run}`, name: `Return cable ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'm' });
    expect(m.status).toBe(200);
    materialId = m.body.id;
    const rack = await api<{ id: string }>('POST', '/locations', { name: `IT return rack ${run}`, type: 'RACK' });
    expect(rack.status).toBe(201);
    rackId = rack.body.id;
    expect((await api('POST', '/projects', { projectNumber, name: `Return project ${run}` })).status).toBe(201);
    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `IT electrician ${run}`, type: 'WORKER' });
    expect(recipient.status).toBe(201);
    expect((await api('POST', '/inventory-adjustments', { materialId, locationId: rackId, quantity: 50, reasonCode: 'COUNT_VARIANCE' })).status).toBe(201);

    const issued = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', {
      recipientId: recipient.body.id, projectNumber, lines: [{ materialId, locationId: rackId, quantity: 30 }],
    });
    expect(issued.status).toBe(201);
    issueId = issued.body.transactionIds[0]!;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('puts returned stock back on the shelf and off the project', async () => {
    expect(await onHand()).toBe('20');
    expect(await consumed()).toBe(30);

    const res = await api<{ returnedQuantity: string; returnableQuantity: string }>('POST', `/inventory-transactions/${issueId}/returns`, {
      quantity: 12, reason: 'Run was shorter than planned',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ returnedQuantity: '12', returnableQuantity: '18' });

    expect(await onHand()).toBe('32');
    expect(await consumed()).toBe(18);
    const history = await api<HistoryRow[]>('GET', `/inventory-transactions?materialId=${materialId}`);
    expect(history.body.find((t) => t.id === issueId)?.returnedQuantity).toBe('12');
    expect(history.body.some((t) => t.type === 'RETURN')).toBe(true);
  });

  it('refuses to return more than is still out', async () => {
    const res = await api<{ error: { message: string } }>('POST', `/inventory-transactions/${issueId}/returns`, { quantity: 19 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/only 18 of the 30 issued/);
    expect(await onHand()).toBe('32');
  });

  it('will not reverse the issue until its returns are reversed', async () => {
    const blocked = await api('POST', `/inventory-transactions/${issueId}/reversal`, { reason: 'Wrong project' });
    expect(blocked.status).toBe(409);

    const history = await api<HistoryRow[]>('GET', `/inventory-transactions?materialId=${materialId}&type=RETURN`);
    const returnId = history.body[0]!.id;
    expect((await api('POST', `/inventory-transactions/${returnId}/reversal`, { reason: 'Return booked by mistake' })).status).toBe(201);
    expect((await api('POST', `/inventory-transactions/${issueId}/reversal`, { reason: 'Wrong project' })).status).toBe(201);

    expect(await onHand()).toBe('50');
    expect(await consumed()).toBe(0);
  });
});
