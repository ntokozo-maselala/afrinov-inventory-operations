// Real-HTTP + real-database tests for stock counts: differences become
// COUNT_VARIANCE adjustments linked to one count, matches post nothing, and a
// count is refused when stock moved while it was being done.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

describe('stock counts over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let rackId: string;
  const items: Record<'disc' | 'gloves' | 'tape' | 'found', string> = { disc: '', gloves: '', tape: '', found: '' };

  /** Return the rack quantity after asserting that its cached balance matches the ledger. */
  async function onHand(materialId: string): Promise<string> {
    const { ledger, balance } = await ledgerAndBalance(materialId, rackId);
    expect(balance).toBe(ledger);
    return ledger;
  }

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const rack = await api<{ id: string }>('POST', '/locations', { name: `IT count rack ${run}`, type: 'RACK' });
    expect(rack.status).toBe(201);
    rackId = rack.body.id;
    for (const [key, qty] of [['disc', 20], ['gloves', 6], ['tape', 4], ['found', 0]] as const) {
      const m = await api<{ id: string }>('POST', '/materials', { sku: `IT-CNT-${key}-${run}`, name: `Count ${key} ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each' });
      expect(m.status).toBe(200);
      items[key] = m.body.id;
      if (qty > 0) expect((await api('POST', '/inventory-adjustments', { materialId: m.body.id, locationId: rackId, quantity: qty, reasonCode: 'OTHER' })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await server?.close();
  });

  it('posts each difference as a count-variance adjustment, and nothing for a match', async () => {
    const res = await api<{ countId: string; counted: number; adjusted: number; lines: Array<{ materialId: string; variance: string; transactionId: string | null }> }>(
      'POST', '/stock-counts', {
        locationId: rackId,
        note: ' Go-live count ',
        lines: [
          { materialId: items.disc, expectedQuantity: 20, countedQuantity: 17 },
          { materialId: items.gloves, expectedQuantity: 6, countedQuantity: 6 },
          { materialId: items.found, expectedQuantity: 0, countedQuantity: 2.5 },
        ],
      },
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ counted: 3, adjusted: 2 });
    expect(res.body.lines.map((l) => [l.materialId, l.variance, l.transactionId !== null])).toEqual([
      [items.disc, '-3', true], [items.gloves, '0', false], [items.found, '2.5', true],
    ]);

    expect(await onHand(items.disc)).toBe('17');
    expect(await onHand(items.gloves)).toBe('6');
    expect(await onHand(items.found)).toBe('2.5');
    expect(await onHand(items.tape)).toBe('4');

    const posted = await prisma.inventoryTransaction.findMany({ where: { referenceType: 'StockCount', referenceId: res.body.countId } });
    expect(posted).toHaveLength(2);
    for (const t of posted) expect(t).toMatchObject({ type: 'ADJUSTMENT', reasonCode: 'COUNT_VARIANCE', reasonNote: 'Stock count: Go-live count', locationId: rackId });
    expect(await prisma.auditLogEntry.findFirst({ where: { entityType: 'StockCount', entityId: res.body.countId } })).toMatchObject({ action: 'STOCK_COUNT' });
  });

  it('counts an item with a negative system balance', async () => {
    const material = await api<{ id: string }>('POST', '/materials', { sku: `IT-CNT-negative-${run}`, name: `Count negative ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each' });
    expect(material.status).toBe(200);
    const materialId = material.body.id;
    const actorId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id;

    // Seed a historical negative balance; ordinary adjustments cannot create one.
    await prisma.$transaction([
      prisma.inventoryTransaction.create({ data: { materialId, locationId: rackId, type: 'ADJUSTMENT', quantity: -3, reasonCode: 'OTHER', actorId } }),
      prisma.inventoryBalance.create({ data: { materialId, locationId: rackId, quantity: -3 } }),
    ]);
    expect(await onHand(materialId)).toBe('-3');

    const res = await api<{ countId: string; counted: number; adjusted: number; lines: Array<{ materialId: string; variance: string; transactionId: string | null }> }>('POST', '/stock-counts', {
      locationId: rackId,
      lines: [{ materialId, expectedQuantity: -3, countedQuantity: 2 }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ counted: 1, adjusted: 1, lines: [{ materialId, variance: '5', transactionId: expect.any(String) }] });
    expect(await onHand(materialId)).toBe('2');

    const posted = await prisma.inventoryTransaction.findMany({ where: { referenceType: 'StockCount', referenceId: res.body.countId } });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ id: res.body.lines[0]?.transactionId, materialId, locationId: rackId, type: 'ADJUSTMENT', reasonCode: 'COUNT_VARIANCE' });
    expect(posted[0]?.quantity.toString()).toBe('5');
  });

  it('refuses the whole count when stock moved while counting, and posts nothing', async () => {
    // The sheet showed 17 discs, but 1 was issued at the counter meanwhile.
    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `IT counter ${run}`, type: 'WORKER' });
    expect((await api('POST', '/inventory-issues', { recipientId: recipient.body.id, lines: [{ materialId: items.disc, locationId: rackId, quantity: 1 }] })).status).toBe(201);

    const res = await api<{ error: { code: string; message: string } }>('POST', '/stock-counts', {
      locationId: rackId,
      lines: [
        { materialId: items.tape, expectedQuantity: 4, countedQuantity: 3 },
        { materialId: items.disc, expectedQuantity: 17, countedQuantity: 15 },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(new RegExp(`IT-CNT-disc-${run}: 17 → 16`));
    expect(await onHand(items.tape)).toBe('4');
    expect(await onHand(items.disc)).toBe('16');
  });

  it('rejects negative counts, repeated items and unknown locations', async () => {
    const line = { materialId: items.tape, expectedQuantity: 4, countedQuantity: 4 };
    expect((await api('POST', '/stock-counts', { locationId: rackId, lines: [{ ...line, countedQuantity: -1 }] })).status).toBe(400);
    expect((await api('POST', '/stock-counts', { locationId: rackId, lines: [line, line] })).status).toBe(400);
    expect((await api('POST', '/stock-counts', { locationId: rackId, lines: [] })).status).toBe(400);
    expect((await api('POST', '/stock-counts', { locationId: '00000000-0000-4000-8000-000000000000', lines: [line] })).status).toBe(404);
  });
});
