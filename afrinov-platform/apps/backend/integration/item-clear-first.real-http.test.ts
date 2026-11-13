// Real-HTTP + real-database tests for what an item's status holds to (ADR-033):
// it is deactivated only when clear, with no override, and on an inactive item
// nothing moves until someone reactivates it. An inactive item never holds stock
// unless it did before the rule, so those tests start from one that did.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, receiveOutstanding, requireAdminPassword, retireAsBefore, runId, startServer, type TestServer } from './helpers.js';
import { checkItemStatus } from '../src/modules/inventory/item-status-check.js';
import { checkMaterialActive } from '../src/modules/inventory/inventory.service.js';
import { recomputeBalance, storesStock } from '../src/shared/inventory/balances.js';

interface Blocker { kind: string; text: string }
interface Refusal { error: { code: string; message: string; details?: { blockers?: Blocker[] } } }

describe('clear first, and nothing moves, over real HTTP', () => {
  const run = runId();
  let n = 0;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let location: string;
  let recipientId: string;
  let supplierId: string;

  const item = async (category = 'CONSUMABLES') => {
    n += 1;
    const sku = `IT-CF-${run}-${n}`;
    const res = await api<{ id: string }>('POST', '/materials', { sku, name: `Clear first ${sku}`, category, unitOfMeasure: 'each', unitCost: 1 });
    expect(res.status).toBe(200);
    return { id: res.body.id, sku };
  };
  const adjust = async (materialId: string, quantity: number, reasonCode = 'OTHER') => {
    const res = await api<{ transactionId: string }>('POST', '/inventory-adjustments', { materialId, locationId: location, quantity, reasonCode, reasonNote: 'For the test' });
    expect(res.status).toBe(201);
    return res.body.transactionId;
  };
  const issue = async (materialId: string, quantity: number) => {
    const res = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', { recipientId, lines: [{ materialId, locationId: location, quantity }] });
    expect(res.status).toBe(201);
    return res.body.transactionIds[0]!;
  };
  const deactivate = (id: string) => api<Refusal>('PATCH', `/materials/${id}/status`, { active: false, reasonCode: 'OBSOLETE' });
  const reactivate = (id: string) => api('PATCH', `/materials/${id}/status`, { active: true, reasonCode: 'STOCK_CAME_BACK' });
  const kinds = async (id: string) => (await api<{ blockers: Blocker[] }>('GET', `/materials/${id}/deactivation-check`)).body.blockers.map((b) => b.kind);
  const isActive = async (id: string) => (await api<{ active: boolean }>('GET', `/materials/${id}`)).body.active;
  const expectInactiveRefusal = (res: { status: number; body: unknown }, sku: string) => {
    expect(res.status).toBe(400);
    expect((res.body as Refusal).error.message).toBe(`${sku} is inactive. Ask a Store Controller to reactivate it first.`);
  };
  const order = async (materialId: string, status = 'APPROVED') => {
    const res = await api<{ id: string; number: string }>('POST', '/purchase-orders', { supplierId, vatRate: 15, lines: [{ materialId, orderedQty: 5, unitPrice: 10 }] });
    expect(res.status).toBe(201);
    if (status !== 'DRAFT') await prisma.purchaseOrder.update({ where: { id: res.body.id }, data: { status: status as 'APPROVED' } });
    return res.body;
  };

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    location = (await api<{ id: string }>('POST', '/locations', { name: `IT clear ${run}`, type: 'RACK' })).body.id;
    recipientId = (await api<{ id: string }>('POST', '/recipients', { name: `IT clear worker ${run}`, type: 'WORKER' })).body.id;
    supplierId = (await api<{ id: string }>('POST', '/suppliers', { name: `IT clear supplier ${run}` })).body.id;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('clear first', () => {
    it('refuses while stock is on hand, says what is in the way, and allows it once written off', async () => {
      const i = await item();
      await adjust(i.id, 7);
      expect(await kinds(i.id)).toEqual(['STOCK']);
      const refused = await deactivate(i.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toContain(`${i.sku} is not clear yet: 7 each on hand`);
      expect(refused.body.error.details?.blockers?.map((b) => b.kind)).toEqual(['STOCK']);
      expect(await isActive(i.id)).toBe(true);
      expect(await prisma.materialStatusChange.count({ where: { materialId: i.id } })).toBe(0);

      await adjust(i.id, -7, 'SCRAP');
      expect(await kinds(i.id)).toEqual([]);
      expect((await deactivate(i.id)).status).toBe(200);
      const rows = (await api<Array<{ type: string; quantity: string | null }>>('GET', `/inventory-transactions?materialId=${i.id}`)).body;
      expect(rows.map((r) => r.type)).toEqual(['ITEM_DEACTIVATED', 'ADJUSTMENT', 'ADJUSTMENT']);
    });

    it('does not count stock moved to another location as cleared', async () => {
      const i = await item();
      const other = (await api<{ id: string }>('POST', '/locations', { name: `IT clear other ${run}`, type: 'RACK' })).body.id;
      await adjust(i.id, 3);
      expect((await api('POST', '/inventory-transfers', { materialId: i.id, fromLocationId: location, toLocationId: other, quantity: 3 })).status).toBe(201);
      expect((await deactivate(i.id)).status).toBe(409);
    });

    it('refuses while a tool is out on loan, and after check-in while it is on the shelf', async () => {
      const i = await item('TOOLS');
      await adjust(i.id, 1);
      const out = await api<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId, lines: [{ materialId: i.id, locationId: location, quantity: 1 }] });
      expect(out.status).toBe(201);
      expect(await kinds(i.id)).toEqual(['LOAN']);
      expect((await deactivate(i.id)).status).toBe(409);
      expect((await api('POST', '/tools/check-in', { lines: [{ loanId: out.body.loanIds[0], quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
      expect(await kinds(i.id)).toEqual(['STOCK']);
    });

    it('refuses while an adjustment waits for approval', async () => {
      const i = await item();
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
      await prisma.adjustmentRequest.create({ data: { materialId: i.id, locationId: location, quantity: 1, reasonCode: 'FOUND', requestedById: admin.id } });
      expect(await kinds(i.id)).toEqual(['APPROVAL']);
      expect((await deactivate(i.id)).status).toBe(409);
    });

    it('refuses while an order still owes some, a draft too, and not once it is cancelled', async () => {
      const i = await item();
      const po = await order(i.id, 'DRAFT');
      expect(await kinds(i.id)).toEqual(['ORDER']);
      expect((await deactivate(i.id)).status).toBe(409);
      await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CANCELLED' } });
      expect((await deactivate(i.id)).status).toBe(200);
    });

    it('does not count stock out with someone, so an issued item can be deactivated', async () => {
      const i = await item();
      await adjust(i.id, 2);
      await issue(i.id, 2);
      expect(await kinds(i.id)).toEqual([]);
      expect((await deactivate(i.id)).status).toBe(200);
    });
  });

  describe('nothing moves', () => {
    it('refuses a return of stock until the item is reactivated, then takes it', async () => {
      const i = await item();
      await adjust(i.id, 2);
      const issued = await issue(i.id, 2);
      expect((await deactivate(i.id)).status).toBe(200);

      const body = { lines: [{ issueTransactionId: issued, quantity: 1 }] };
      expectInactiveRefusal(await api('POST', '/inventory-returns', body), i.sku);
      expect((await ledgerAndBalance(i.id, location)).balance).toBe('0');

      expect((await reactivate(i.id)).status).toBe(200);
      expect((await api('POST', '/inventory-returns', body)).status).toBe(201);
      expect((await ledgerAndBalance(i.id, location)).balance).toBe('1');
    });

    it('still books used up on an inactive item, as no stock moves', async () => {
      const i = await item();
      expect((await api('PATCH', `/materials/${i.id}`, { trackUse: true })).status).toBe(200);
      await adjust(i.id, 2);
      const issued = await issue(i.id, 2);
      expect((await deactivate(i.id)).status).toBe(200);
      expect((await api('POST', '/inventory-returns', { lines: [{ issueTransactionId: issued, usedUp: 2 }] })).status).toBe(201);
    });

    it('refuses a reversal, which would put stock back', async () => {
      const i = await item();
      await adjust(i.id, 2);
      const writeOff = await adjust(i.id, -2, 'SCRAP');
      expect((await deactivate(i.id)).status).toBe(200);
      expectInactiveRefusal(await api('POST', `/inventory-transactions/${writeOff}/reversal`, { reason: 'Written off by mistake' }), i.sku);
      expect((await ledgerAndBalance(i.id, location)).balance).toBe('0');
    });

    it('refuses a stock count difference, but not a count that matches', async () => {
      const i = await item();
      expect((await deactivate(i.id)).status).toBe(200);
      const count = (countedQuantity: number) => api('POST', '/stock-counts', { locationId: location, lines: [{ materialId: i.id, expectedQuantity: 0, countedQuantity }] });
      expectInactiveRefusal(await count(1), i.sku);
      expect((await count(0)).status).toBe(201);
    });

    it('refuses a new order, and sending a draft from before', async () => {
      const i = await item();
      const draft = await order(i.id, 'DRAFT');
      await prisma.purchaseOrder.update({ where: { id: draft.id }, data: { status: 'CANCELLED' } });
      expect((await deactivate(i.id)).status).toBe(200);
      expectInactiveRefusal(await api('POST', '/purchase-orders', { supplierId, vatRate: 15, lines: [{ materialId: i.id, orderedQty: 5, unitPrice: 10 }] }), i.sku);
      await prisma.purchaseOrder.update({ where: { id: draft.id }, data: { status: 'DRAFT' } });
      expectInactiveRefusal(await api('POST', `/purchase-orders/${draft.id}/submit`), i.sku);
    });

    it('refuses a delivery on an order from before the rule', async () => {
      const i = await item();
      const po = await order(i.id);
      await retireAsBefore(i.id);
      expectInactiveRefusal(await receiveOutstanding(api, po.id, location), i.sku);
      expect((await ledgerAndBalance(i.id, location)).balance).toBe('0');
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('APPROVED');
    });

    it('refuses a tool check-in on an item from before the rule, until it is reactivated', async () => {
      const i = await item('TOOLS');
      await adjust(i.id, 1);
      const out = await api<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId, lines: [{ materialId: i.id, locationId: location, quantity: 1 }] });
      await retireAsBefore(i.id);
      const body = { lines: [{ loanId: out.body.loanIds[0], quantity: 1, condition: 'GOOD' }] };
      expectInactiveRefusal(await api('POST', '/tools/check-in', body), i.sku);
      expect((await reactivate(i.id)).status).toBe(200);
      expect((await api('POST', '/tools/check-in', body)).status).toBe(201);
    });

    it('lets an item from before the rule be reactivated, cleared and deactivated', async () => {
      const i = await item();
      await adjust(i.id, 4);
      await retireAsBefore(i.id);
      expect((await checkItemStatus(prisma)).inactiveHoldingStock.map((x) => x.sku)).toContain(i.sku);

      expect((await reactivate(i.id)).status).toBe(200);
      await adjust(i.id, -4, 'SCRAP');
      expect((await deactivate(i.id)).status).toBe(200);
      expect((await checkItemStatus(prisma)).inactiveHoldingStock.map((x) => x.sku)).not.toContain(i.sku);
    });
  });

  it('makes a deactivation wait for a movement that has passed the check, then sees its stock', async () => {
    const i = await item();
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    let settled = false;
    let attempt!: Promise<{ status: number }>;
    await prisma.$transaction(async (tx) => {
      // The movement has checked the item is active, and has not posted yet.
      await checkMaterialActive(i.id, tx);
      attempt = deactivate(i.id).finally(() => { settled = true; });
      await new Promise((resolve) => { setTimeout(resolve, 400); });
      expect(settled).toBe(false);
      await tx.inventoryTransaction.create({ data: { materialId: i.id, locationId: location, type: 'RECEIPT', quantity: 1, actorId: admin.id } });
      await recomputeBalance(storesStock(i.id, location), tx);
    });
    expect((await attempt).status).toBe(409);
    expect(await isActive(i.id)).toBe(true);
  });

  it('never leaves stock on an inactive item when a movement and a deactivation race', async () => {
    for (let round = 0; round < 8; round += 1) {
      const i = await item();
      const [moved, retired] = await Promise.all([
        api('POST', '/inventory-adjustments', { materialId: i.id, locationId: location, quantity: 1, reasonCode: 'OTHER', reasonNote: 'Racing' }),
        deactivate(i.id),
      ]);
      const { balance } = await ledgerAndBalance(i.id, location);
      // One or the other wins: the stock came in and the item stayed active, or the item went first and the stock was refused.
      if (retired.status === 200) {
        expect(moved.status).toBe(400);
        expect(balance).toBe('0');
      } else {
        expect(retired.status).toBe(409);
        expect(moved.status).toBe(201);
        expect(balance).toBe('1');
      }
    }
  });

  it('keeps every item in step with its record', async () => {
    expect((await checkItemStatus(prisma)).mismatched).toEqual([]);
  });
});
