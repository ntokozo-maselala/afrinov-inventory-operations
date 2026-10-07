// Real-HTTP + real-database tests for stock movements: adjustments, issues
// and transfers. After every movement the stored balance must equal the sum
// of the ledger (ADR-002), and a rejected movement must leave no trace.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ADMIN_EMAIL,
  client,
  ledgerAndBalance,
  login,
  prisma,
  requireAdminPassword,
  runId,
  startServer,
  type TestServer,
} from './helpers.js';

interface StockRow {
  materialId: string;
  locationId: string;
  quantity: string;
}

describe('stock movements over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let storeA: string;
  let storeB: string;

  async function stockAt(locationId: string): Promise<string> {
    const res = await api<StockRow[]>('GET', `/reports/current-stock?materialId=${materialId}&locationId=${locationId}`);
    expect(res.status).toBe(200);
    return res.body[0]?.quantity ?? '0';
  }

  async function expectLedgerMatches(locationId: string, expected: string): Promise<void> {
    const { ledger, balance } = await ledgerAndBalance(materialId, locationId);
    expect(ledger).toBe(expected);
    expect(balance).toBe(expected);
    expect(await stockAt(locationId)).toBe(expected);
  }

  async function transactionCount(): Promise<number> {
    return prisma.inventoryTransaction.count({ where: { materialId } });
  }

  beforeAll(async () => {
    const password = requireAdminPassword();
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, password));

    const material = await api<{ id: string }>('POST', '/materials', {
      sku: `IT-${run}`,
      name: `Integration bolt ${run}`,
      category: 'CONSUMABLES',
      unitOfMeasure: 'each',
      requiredStock: 5,
    });
    // POST /materials answers 200, unlike the other create endpoints (201).
    expect(material.status).toBe(200);
    materialId = material.body.id;

    const a = await api<{ id: string }>('POST', '/locations', { name: `IT store A ${run}`, type: 'STOREROOM' });
    const b = await api<{ id: string }>('POST', '/locations', { name: `IT store B ${run}`, type: 'STOREROOM' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    storeA = a.body.id;
    storeB = b.body.id;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('a positive adjustment brings stock in', async () => {
    const res = await api('POST', '/inventory-adjustments', {
      materialId,
      locationId: storeA,
      quantity: 100,
      reasonCode: 'COUNT_VARIANCE',
      reasonNote: 'Opening count',
    });
    expect(res.status).toBe(201);
    await expectLedgerMatches(storeA, '100');
  });

  it('an issue takes stock out', async () => {
    const res = await api('POST', '/inventory-issues', { materialId, locationId: storeA, quantity: 30 });
    expect(res.status).toBe(201);
    await expectLedgerMatches(storeA, '70');
  });

  it('a transfer moves stock between locations as two linked legs', async () => {
    const res = await api<{ outTransactionId: string; inTransactionId: string }>('POST', '/inventory-transfers', {
      materialId,
      fromLocationId: storeA,
      toLocationId: storeB,
      quantity: 25,
    });
    expect(res.status).toBe(201);
    await expectLedgerMatches(storeA, '45');
    await expectLedgerMatches(storeB, '25');

    const [out, inn] = await Promise.all([
      prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: res.body.outTransactionId } }),
      prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: res.body.inTransactionId } }),
    ]);
    expect(out.type).toBe('TRANSFER_OUT');
    expect(inn.type).toBe('TRANSFER_IN');
    expect(out.pairedWithId).toBe(inn.id);
    expect(inn.pairedWithId).toBe(out.id);
  });

  it('a negative adjustment writes stock off with its reason', async () => {
    const res = await api('POST', '/inventory-adjustments', {
      materialId,
      locationId: storeB,
      quantity: -5,
      reasonCode: 'DAMAGE',
    });
    expect(res.status).toBe(201);
    await expectLedgerMatches(storeB, '20');
  });

  it('rejects a transfer larger than the source balance and records nothing', async () => {
    const before = await transactionCount();
    const res = await api<{ error: { code: string } }>('POST', '/inventory-transfers', {
      materialId,
      fromLocationId: storeA,
      toLocationId: storeB,
      quantity: 1000,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await transactionCount()).toBe(before);
    await expectLedgerMatches(storeA, '45');
    await expectLedgerMatches(storeB, '20');
  });

  it('rejects invalid movements with 400 and records nothing', async () => {
    const before = await transactionCount();

    const sameLocation = await api('POST', '/inventory-transfers', {
      materialId,
      fromLocationId: storeA,
      toLocationId: storeA,
      quantity: 1,
    });
    expect(sameLocation.status).toBe(400);

    const zeroAdjustment = await api('POST', '/inventory-adjustments', {
      materialId,
      locationId: storeA,
      quantity: 0,
      reasonCode: 'OTHER',
    });
    expect(zeroAdjustment.status).toBe(400);

    const negativeIssue = await api('POST', '/inventory-issues', { materialId, locationId: storeA, quantity: -3 });
    expect(negativeIssue.status).toBe(400);

    expect(await transactionCount()).toBe(before);
  });

  it('refuses movements on an inactive material', async () => {
    const deactivate = await api('PATCH', `/materials/${materialId}`, { active: false });
    expect(deactivate.status).toBe(200);
    try {
      const res = await api('POST', '/inventory-issues', { materialId, locationId: storeA, quantity: 1 });
      expect(res.status).toBe(400);
      await expectLedgerMatches(storeA, '45');
    } finally {
      await api('PATCH', `/materials/${materialId}`, { active: true });
    }
  });

  it('lists every movement in the history, newest first', async () => {
    const res = await api<Array<{ type: string; quantity: string; locationId: string }>>(
      'GET',
      `/inventory-transactions?materialId=${materialId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.map((t) => t.type).sort()).toEqual(
      ['ADJUSTMENT', 'ADJUSTMENT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT'].sort(),
    );
  });

  it('forbids a read-only user from moving stock', async () => {
    const email = `it-viewer-${run}@example.com`;
    const password = `viewer-${run}-pass`;
    const created = await api('POST', '/users', { email, name: `IT viewer ${run}`, password, roleNames: ['VIEWER'] });
    expect(created.status).toBe(201);

    const viewer = client(server.port, await login(server.port, email, password));
    const before = await transactionCount();
    const res = await viewer('POST', '/inventory-issues', { materialId, locationId: storeA, quantity: 1 });
    expect(res.status).toBe(403);
    expect(await transactionCount()).toBe(before);
  });
});
