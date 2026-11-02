// Real-HTTP + real-database tests for who was responsible for a write-off:
// damage, loss and scrap may name a recipient (with a note saying what
// happened), the Write-offs report filters by it, and its totals value each
// person's write-offs at unit cost, leaving reversed write-offs out.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Movement { id: string; reasonCode: string | null; recipientId: string | null; recipientName: string | null }
interface Totals {
  currency: string;
  totals: Array<{ recipientId: string | null; recipientName: string | null; recipientType: string | null; count: number; value: string }>;
}

describe('who was responsible for a write-off, over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let locationId: string;
  let fitter: string;
  let forklift: string;

  const adjust = (body: Record<string, unknown>) =>
    api<{ transactionId: string; error?: { code: string; message: string } }>('POST', '/inventory-adjustments', { materialId, locationId, ...body });
  const writeoffs = (extra = '') => api<Movement[]>('GET', `/inventory-transactions?report=writeoffs&locationId=${locationId}${extra}`);
  const totals = async () => (await api<Totals>('GET', `/inventory-transactions/writeoffs-by-responsible?locationId=${locationId}`)).body.totals;

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));

    const material = await api<{ id: string }>('POST', '/materials', {
      sku: `WR-${run}`, name: `Write-off disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 32,
    });
    expect(material.status).toBe(200);
    materialId = material.body.id;
    const location = await api<{ id: string }>('POST', '/locations', { name: `WR store ${run}`, type: 'STOREROOM' });
    expect(location.status).toBe(201);
    locationId = location.body.id;
    const a = await api<{ id: string }>('POST', '/recipients', { name: `WR fitter ${run}`, type: 'WORKER' });
    const b = await api<{ id: string }>('POST', '/recipients', { name: `WR forklift ${run}`, type: 'MACHINE' });
    expect([a.status, b.status]).toEqual([201, 201]);
    fitter = a.body.id;
    forklift = b.body.id;

    expect((await adjust({ quantity: 50, reasonCode: 'COUNT_VARIANCE', reasonNote: 'Opening count' })).status).toBe(201);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('records who damaged stock, and the report shows and filters by them', async () => {
    const res = await adjust({ quantity: -3, reasonCode: 'DAMAGE', reasonNote: 'Dropped off the bench', recipientId: fitter });
    expect(res.status).toBe(201);
    const row = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
    expect(row.recipientId).toBe(fitter);

    const mine = await writeoffs(`&recipientId=${fitter}`);
    expect(mine.body.map((m) => [m.reasonCode, m.recipientName])).toEqual([['DAMAGE', `WR fitter ${run}`]]);
  });

  it('records a loss with nobody known, and "nobody known" leaves other adjustments out', async () => {
    expect((await adjust({ quantity: -2, reasonCode: 'LOSS', recipientId: null })).status).toBe(201);
    expect((await adjust({ quantity: 1, reasonCode: 'OTHER', reasonNote: 'Found behind the rack' })).status).toBe(201);

    const unknown = await writeoffs('&recipientId=__none__');
    expect(unknown.body.map((m) => m.reasonCode)).toEqual(['LOSS']);
    // The opening count (not from Count stock), the damage, the loss and the other adjustment.
    expect((await writeoffs()).body).toHaveLength(4);
  });

  it('refuses a named person without a note, on another reason, or inactive, and records nothing', async () => {
    const before = await prisma.inventoryTransaction.count({ where: { materialId } });
    const noNote = await adjust({ quantity: -1, reasonCode: 'SCRAP', recipientId: forklift });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error?.message).toMatch(/Say what happened/);
    expect((await adjust({ quantity: -1, reasonCode: 'OTHER', reasonNote: 'x', recipientId: forklift })).status).toBe(400);

    await prisma.recipient.update({ where: { id: forklift }, data: { active: false } });
    const inactive = await adjust({ quantity: -1, reasonCode: 'DAMAGE', reasonNote: 'Crushed a box', recipientId: forklift });
    await prisma.recipient.update({ where: { id: forklift }, data: { active: true } });
    expect(inactive.status).toBe(400);
    expect(await prisma.inventoryTransaction.count({ where: { materialId } })).toBe(before);
  });

  it('totals write-offs by who was responsible at unit cost, leaving reversed ones out', async () => {
    const crushed = await adjust({ quantity: -5, reasonCode: 'DAMAGE', reasonNote: 'Pallet crushed the box', recipientId: forklift });
    expect(crushed.status).toBe(201);
    expect(await totals()).toEqual([
      { recipientId: forklift, recipientName: `WR forklift ${run}`, recipientType: 'MACHINE', count: 1, value: '160.00' },
      { recipientId: fitter, recipientName: `WR fitter ${run}`, recipientType: 'WORKER', count: 1, value: '96.00' },
      { recipientId: null, recipientName: null, recipientType: null, count: 1, value: '64.00' },
    ]);

    // A reversal keeps the person (it copies the recipient), and both legs drop out of the totals.
    const reversal = await api<{ reversalIds: string[] }>('POST', `/inventory-transactions/${crushed.body.transactionId}/reversal`, { reason: 'Wrong item' });
    expect(reversal.status).toBe(201);
    const reversed = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: reversal.body.reversalIds[0]! } });
    expect(reversed.recipientId).toBe(forklift);
    expect((await totals()).map((t) => t.recipientId)).toEqual([fitter, null]);
  });
});
