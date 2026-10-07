// Real-HTTP + real-database tests for receiving stock against purchase
// orders, by posting goods receipts and by marking an order delivered.
// Receiving must add exactly the received quantity to stock, never twice, and
// a rejected posting must roll back completely.
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

interface PurchaseOrder {
  id: string;
  status: string;
  lines: Array<{ id: string; orderedQty: string; receivedQty: string }>;
}

interface GoodsReceipt {
  id: string;
  status: string;
}

describe('receiving stock over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let locationId: string;
  let supplierId: string;

  async function expectStock(expected: string): Promise<void> {
    const { ledger, balance } = await ledgerAndBalance(materialId, locationId);
    expect(ledger).toBe(expected);
    expect(balance).toBe(expected);
  }

  async function getOrder(id: string): Promise<PurchaseOrder> {
    const res = await api<PurchaseOrder>('GET', `/purchase-orders/${id}`);
    expect(res.status).toBe(200);
    return res.body;
  }

  /** Creates a purchase order for `qty` units and takes it to APPROVED. */
  async function approvedOrder(qty: number): Promise<PurchaseOrder> {
    const created = await api<PurchaseOrder>('POST', '/purchase-orders', {
      supplierId,
      lines: [{ materialId, orderedQty: qty, unitPrice: 12.5 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');

    const submitted = await api<PurchaseOrder>('POST', `/purchase-orders/${created.body.id}/submit`);
    expect(submitted.status).toBe(200);
    // Submission auto-approves when the approval setting is off.
    if (submitted.body.status === 'PENDING_APPROVAL') {
      const approved = await api<PurchaseOrder>('POST', `/purchase-orders/${created.body.id}/approve`);
      expect(approved.status).toBe(200);
    }
    const order = await getOrder(created.body.id);
    expect(order.status).toBe('APPROVED');
    return order;
  }

  async function receive(order: PurchaseOrder, quantity: number): Promise<GoodsReceipt> {
    const res = await api<GoodsReceipt>('POST', '/goods-receipts', {
      purchaseOrderId: order.id,
      supplierId,
      deliveryRef: `DN-${run}`,
      lines: [{ materialId, locationId, quantity, purchaseOrderLineId: order.lines[0]!.id }],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUBMITTED');
    return res.body;
  }

  beforeAll(async () => {
    const password = requireAdminPassword();
    server = await startServer({ procurementEnabled: true });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, password));

    const material = await api<{ id: string }>('POST', '/materials', {
      sku: `IT-PO-${run}`,
      name: `Integration cable ${run}`,
      category: 'PROJECT_MATERIAL',
      unitOfMeasure: 'm',
    });
    expect(material.status).toBe(200);
    materialId = material.body.id;

    const location = await api<{ id: string }>('POST', '/locations', { name: `IT receiving ${run}`, type: 'STOREROOM' });
    expect(location.status).toBe(201);
    locationId = location.body.id;

    const supplier = await api<{ id: string }>('POST', '/suppliers', { name: `IT Supplier ${run}` });
    expect(supplier.status).toBe(201);
    supplierId = supplier.body.id;
  });

  afterAll(async () => {
    await server?.close();
  });

  describe('goods receipts', () => {
    let order: PurchaseOrder;

    beforeAll(async () => {
      order = await approvedOrder(10);
    });

    it('posting a receipt adds its quantity to stock and part-receives the order', async () => {
      const receipt = await receive(order, 4);
      const posted = await api<GoodsReceipt>('POST', `/goods-receipts/${receipt.id}/post`);
      expect(posted.status).toBe(200);
      expect(posted.body.status).toBe('POSTED');

      await expectStock('4');
      const after = await getOrder(order.id);
      expect(after.status).toBe('PARTIALLY_RECEIVED');
      expect(Number(after.lines[0]!.receivedQty)).toBe(4);

      const ledger = await prisma.inventoryTransaction.findMany({ where: { referenceId: receipt.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.type).toBe('RECEIPT');
      expect(ledger[0]!.referenceType).toBe('GoodsReceipt');
    });

    it('refuses to post the same receipt twice', async () => {
      const receipt = await prisma.goodsReceipt.findFirstOrThrow({
        where: { purchaseOrderId: order.id, status: 'POSTED' },
      });
      const again = await api<{ error: { code: string } }>('POST', `/goods-receipts/${receipt.id}/post`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVALID_STATE');
      await expectStock('4');
    });

    it('rolls back a receipt that would exceed the ordered quantity', async () => {
      const tooMuch = await receive(order, 7); // 4 already received + 7 > 10 ordered
      const res = await api<{ error: { code: string } }>('POST', `/goods-receipts/${tooMuch.id}/post`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      // Nothing from the failed posting survives.
      await expectStock('4');
      expect(await prisma.inventoryTransaction.count({ where: { referenceId: tooMuch.id } })).toBe(0);
      const stillOpen = await api<GoodsReceipt>('GET', `/goods-receipts/${tooMuch.id}`);
      expect(stillOpen.body.status).toBe('SUBMITTED');
      expect(Number((await getOrder(order.id)).lines[0]!.receivedQty)).toBe(4);
    });

    it('receiving the remainder fully receives the order', async () => {
      const rest = await receive(order, 6);
      const posted = await api('POST', `/goods-receipts/${rest.id}/post`);
      expect(posted.status).toBe(200);

      await expectStock('10');
      const after = await getOrder(order.id);
      expect(after.status).toBe('FULLY_RECEIVED');
      expect(Number(after.lines[0]!.receivedQty)).toBe(10);
    });
  });

  describe('delivering an order', () => {
    it('ship then deliver receives the full ordered quantity once', async () => {
      const order = await approvedOrder(8);

      const shipped = await api<PurchaseOrder>('POST', `/purchase-orders/${order.id}/ship`, { carrier: 'IT Couriers' });
      expect(shipped.status).toBe(200);
      expect(shipped.body.status).toBe('SHIPPED');

      const delivered = await api<PurchaseOrder>('POST', `/purchase-orders/${order.id}/deliver`, { locationId });
      expect(delivered.status).toBe(200);
      expect(delivered.body.status).toBe('DELIVERED');

      await expectStock('18'); // 10 from the goods receipts + 8 delivered
      const ledger = await prisma.inventoryTransaction.findMany({ where: { referenceId: order.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.referenceType).toBe('PurchaseOrder');
      expect(ledger[0]!.quantity.toString()).toBe('8');

      const again = await api('POST', `/purchase-orders/${order.id}/deliver`, { locationId });
      expect(again.status).toBe(409);
      await expectStock('18');
    });

    it('cannot deliver an order that has not shipped', async () => {
      const order = await approvedOrder(3);
      const res = await api<{ error: { code: string } }>('POST', `/purchase-orders/${order.id}/deliver`, { locationId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
      await expectStock('18');
    });
  });
});
