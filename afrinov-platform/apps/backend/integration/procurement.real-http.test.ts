// Real-HTTP + real-database tests for receiving stock against purchase
// orders, by posting goods receipts and by receiving a whole order at once.
// Receiving must add exactly the received quantity to stock, never twice, and
// a rejected posting must roll back completely.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ADMIN_EMAIL,
  client,
  ledgerAndBalance,
  letAdminSign, login,
  prisma,
  requireAdminPassword,
  runId,
  secondAdmin,
  startServer,
  type TestServer,
} from './helpers.js';

interface PurchaseOrder {
  id: string;
  status: string;
  lines: Array<{ id: string; materialId: string; orderedQty: string; receivedQty: string }>;
}

interface GoodsReceipt {
  id: string;
  status: string;
}

describe('receiving stock over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  /** Approves what the admin raises: nobody approves their own order. */
  let checker: ReturnType<typeof client>;
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
  async function approvedOrder(qty: number, selectedMaterialId = materialId): Promise<PurchaseOrder> {
    const created = await api<PurchaseOrder>('POST', '/purchase-orders', {
      supplierId,
      lines: [{ materialId: selectedMaterialId, orderedQty: qty, unitPrice: 12.5 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');

    const submitted = await api<PurchaseOrder>('POST', `/purchase-orders/${created.body.id}/submit`);
    expect(submitted.status).toBe(200);
    // Submission auto-approves when the approval setting is off.
    if (submitted.body.status === 'PENDING_APPROVAL') {
      const approved = await checker<PurchaseOrder>('POST', `/purchase-orders/${created.body.id}/approve`);
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
      lines: [{ materialId: order.lines[0]!.materialId, locationId, quantity, purchaseOrderLineId: order.lines[0]!.id }],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUBMITTED');
    return res.body;
  }

  beforeAll(async () => {
    const password = requireAdminPassword();
    server = await startServer({ procurementEnabled: true });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, password));
    await letAdminSign(api);
    checker = await secondAdmin(server.port, api, run);

    const material = await api<{ id: string }>('POST', '/materials', {
      sku: `IT-PO-${run}`,
      name: `Integration cable ${run}`,
      category: 'CONSUMABLES',
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

  // Receive stock is the one place a delivery to the store is booked: against
  // an order it sends the delivery date and an Idempotency-Key.
  describe('a delivery against an order, as Receive stock books it', () => {
    // Its own location, so the stock counted by the tests below is untouched.
    let into: string;
    beforeAll(async () => {
      const location = await api<{ id: string }>('POST', '/locations', { name: `IT receive stock ${run}`, type: 'STOREROOM' });
      expect(location.status).toBe(201);
      into = location.body.id;
    });
    const body = (order: PurchaseOrder, extra: Record<string, unknown> = {}) => ({
      purchaseOrderId: order.id, supplierId, deliveryRef: `RS-${run}`, post: true,
      lines: [{ materialId: order.lines[0]!.materialId, locationId: into, quantity: 2, purchaseOrderLineId: order.lines[0]!.id }],
      ...extra,
    });

    // Every delivery to the store is against an approved Stores order.
    it('refuses a delivery with no order, by either way in', async () => {
      const line = { materialId, locationId: into, quantity: 1 };
      const counter = await api<{ error: { message: string } }>('POST', '/stock-receipts', { supplierId, deliveryRef: `NO-PO-${run}`, lines: [line] });
      expect(counter.status).toBe(400);
      expect(counter.body.error.message).toMatch(/booked against an approved Stores order/);
      const receipt = await api<{ error: { message: string } }>('POST', '/goods-receipts', { supplierId, deliveryRef: `NO-PO-${run}`, lines: [line], post: true });
      expect(receipt.status).toBe(400);
      expect(receipt.body.error.message).toMatch(/booked against an approved Stores order/);
      const { ledger } = await ledgerAndBalance(materialId, into);
      expect(Number(ledger)).toBe(0);
    });

    // Qodo, PR #125: one saved with no order before receipts needed one isn't posted either.
    it('refuses to post a receipt saved with no order', async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
      const saved = await prisma.goodsReceipt.create({
        data: {
          number: `GR-IT-NOPO-${run}`, supplierId, receivedById: admin.id, status: 'SUBMITTED',
          lines: { create: [{ materialId, locationId: into, quantity: 1 }] },
        },
      });
      const res = await api<{ error: { message: string } }>('POST', `/goods-receipts/${saved.id}/post`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/booked against an approved Stores order/);
      expect((await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe('SUBMITTED');
      const { ledger } = await ledgerAndBalance(materialId, into);
      expect(Number(ledger)).toBe(0);
    });

    it('keeps the delivery date given', async () => {
      const order = await approvedOrder(5);
      const res = await api<{ receivedAt: string; status: string }>('POST', '/goods-receipts', body(order, { receivedAt: '2026-10-20' }));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('POSTED');
      expect(res.body.receivedAt.slice(0, 10)).toBe('2026-10-20');
    });

    it('refuses a delivery date still to come, booking nothing', async () => {
      const order = await approvedOrder(5);
      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const res = await api<{ error: { message: string } }>('POST', '/goods-receipts', body(order, { receivedAt: future }));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/cannot be in the future/);
      expect((await getOrder(order.id)).lines[0]!.receivedQty).toMatch(/^0(\.0+)?$/);
    });

    it('replays a retried delivery instead of booking it twice', async () => {
      const order = await approvedOrder(5);
      const key = `rs-${run}-${order.id}`;
      const first = await api<{ id: string; number: string }>('POST', '/goods-receipts', body(order), { 'idempotency-key': key });
      expect(first.status).toBe(201);
      const retry = await api<{ id: string; number: string }>('POST', '/goods-receipts', body(order), { 'idempotency-key': key });
      expect(retry.status).toBe(201);
      expect(retry.headers.get('idempotency-replayed')).toBe('true');
      expect(retry.body.number).toBe(first.body.number);
      const after = await getOrder(order.id);
      expect(Number(after.lines[0]!.receivedQty)).toBe(2);
      expect(after.status).toBe('PARTIALLY_RECEIVED');
      // The same key for another delivery is refused, not replayed.
      const other = await api<{ error: { code: string } }>('POST', '/goods-receipts', { ...body(order), deliveryRef: `RS2-${run}` }, { 'idempotency-key': key });
      expect(other.status).toBe(409);
      expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('goods receipts', () => {
    let order: PurchaseOrder;

    beforeAll(async () => {
      order = await approvedOrder(10);
    });

    // Lines without their order line used to book the stock but leave the
    // order showing it as owed (procurement workflow Phase 1).
    it('refuses a receipt against an order whose lines do not name their order line', async () => {
      const res = await api<{ error: { code: string; message: string } }>('POST', '/goods-receipts', {
        purchaseOrderId: order.id, supplierId, deliveryRef: `DN-${run}-x`,
        lines: [{ materialId, locationId, quantity: 1 }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/must name the order line/);
      await expectStock('0');
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

    it('posts a receipt at most once when the same receipt is posted concurrently', async () => {
      const concurrentMaterial = await api<{ id: string }>('POST', '/materials', { sku: 'IT-WP3-SAME-' + run, name: 'WP3 same receipt ' + run, category: 'CONSUMABLES', unitOfMeasure: 'each' });
      const concurrentOrder = await approvedOrder(1, concurrentMaterial.body.id);
      const receipt = await receive(concurrentOrder, 1);
      const results = await Promise.all([
        api('POST', '/goods-receipts/' + receipt.id + '/post'),
        api('POST', '/goods-receipts/' + receipt.id + '/post'),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(await prisma.inventoryTransaction.count({ where: { referenceId: receipt.id } })).toBe(1);
      expect(Number((await getOrder(concurrentOrder.id)).lines[0]!.receivedQty)).toBe(1);
    });

    it('serializes distinct receipts against one PO line when their total exceeds the order', async () => {
      const concurrentMaterial = await api<{ id: string }>('POST', '/materials', { sku: 'IT-WP3-DISTINCT-' + run, name: 'WP3 distinct receipts ' + run, category: 'CONSUMABLES', unitOfMeasure: 'each' });
      const concurrentOrder = await approvedOrder(1, concurrentMaterial.body.id);
      const first = await receive(concurrentOrder, 1);
      const second = await receive(concurrentOrder, 1);
      const results = await Promise.all([
        api('POST', '/goods-receipts/' + first.id + '/post'),
        api('POST', '/goods-receipts/' + second.id + '/post'),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(await prisma.inventoryTransaction.count({ where: { referenceType: 'GoodsReceipt', referenceId: { in: [first.id, second.id] } } })).toBe(1);
      expect(Number((await getOrder(concurrentOrder.id)).lines[0]!.receivedQty)).toBe(1);
    });

    it('refuses to record a receipt for more than is outstanding', async () => {
      // 4 of 10 received: 6 outstanding.
      const res = await api<{ error: { code: string; message: string } }>('POST', '/goods-receipts', {
        purchaseOrderId: order.id, supplierId, deliveryRef: `DN-${run}-over`,
        lines: [{ materialId, locationId, quantity: 7, purchaseOrderLineId: order.lines[0]!.id }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/would exceed what is still outstanding/);
      expect(await prisma.goodsReceipt.count({ where: { deliveryRef: `DN-${run}-over` } })).toBe(0);
      await expectStock('4');
    });

    // Two receipts each within what is outstanding when recorded can still be
    // too much together: the second is refused at posting, and rolls back.
    it('rolls back a receipt that would exceed the ordered quantity when posted', async () => {
      const first = await receive(order, 3);
      const second = await receive(order, 4); // each within the 6 outstanding; 4 + 3 + 4 > 10
      expect((await api('POST', `/goods-receipts/${first.id}/post`)).status).toBe(200);
      await expectStock('7');

      const res = await api<{ error: { code: string } }>('POST', `/goods-receipts/${second.id}/post`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      // Nothing from the failed posting survives.
      await expectStock('7');
      expect(await prisma.inventoryTransaction.count({ where: { referenceId: second.id } })).toBe(0);
      const stillOpen = await api<GoodsReceipt>('GET', `/goods-receipts/${second.id}`);
      expect(stillOpen.body.status).toBe('SUBMITTED');
      expect(Number((await getOrder(order.id)).lines[0]!.receivedQty)).toBe(7);
    });

    it('receiving the remainder fully receives the order', async () => {
      const rest = await receive(order, 3);
      const posted = await api('POST', `/goods-receipts/${rest.id}/post`);
      expect(posted.status).toBe(200);

      await expectStock('10');
      const after = await getOrder(order.id);
      expect(after.status).toBe('RECEIVED');
      expect(Number(after.lines[0]!.receivedQty)).toBe(10);
    });
  });

  describe('receiving a whole order and closing', () => {
    it('receive books everything outstanding once and marks the order RECEIVED', async () => {
      const order = await approvedOrder(8);

      const received = await api<PurchaseOrder>('POST', `/purchase-orders/${order.id}/receive`, { locationId });
      expect(received.status).toBe(200);
      expect(received.body.status).toBe('RECEIVED');

      await expectStock('18'); // 10 from the goods receipts + 8 received
      const ledger = await prisma.inventoryTransaction.findMany({ where: { referenceId: order.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.referenceType).toBe('PurchaseOrder');
      expect(ledger[0]!.quantity.toString()).toBe('8');

      const again = await api('POST', `/purchase-orders/${order.id}/receive`, { locationId });
      expect(again.status).toBe(409);
      await expectStock('18');

      const closed = await api<PurchaseOrder>('POST', `/purchase-orders/${order.id}/close`, {});
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('CLOSED');
    });

    it('cannot receive an order that has not been approved', async () => {
      const draft = await api<PurchaseOrder>('POST', '/purchase-orders', {
        supplierId,
        lines: [{ materialId, orderedQty: 3 }],
      });
      expect(draft.status).toBe(201);
      const res = await api<{ error: { code: string } }>('POST', `/purchase-orders/${draft.body.id}/receive`, { locationId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
      await expectStock('18');
    });

    it('closing short needs a reason, and a closed order takes no more receipts', async () => {
      const order = await approvedOrder(5);
      const part = await receive(order, 2);
      expect((await api('POST', `/goods-receipts/${part.id}/post`)).status).toBe(200);
      expect((await getOrder(order.id)).status).toBe('PARTIALLY_RECEIVED');
      await expectStock('20');

      const noReason = await api<{ error: { code: string } }>('POST', `/purchase-orders/${order.id}/close`, {});
      expect(noReason.status).toBe(400);

      const closed = await api<PurchaseOrder>('POST', `/purchase-orders/${order.id}/close`, { reason: 'Supplier cannot supply the rest' });
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('CLOSED');

      const late = await api<{ error: { code: string } }>('POST', '/goods-receipts', {
        purchaseOrderId: order.id,
        supplierId,
        lines: [{ materialId, locationId, quantity: 1, purchaseOrderLineId: order.lines[0]!.id }],
      });
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('INVALID_STATE');
      await expectStock('20');
    });
  });

  describe('prices and VAT', () => {
    interface Priced { id: string; currency: string; vatRate: string; lines: Array<{ id: string; unitPrice: string | null; net: string | null }>; totals: { subtotal: string; vat: string; net: string; unpricedLines: number } }

    it('keeps the unit price and returns line and order totals', async () => {
      const created = await api<{ id: string }>('POST', '/purchase-orders', { supplierId, vatRate: 15, lines: [{ materialId, orderedQty: 3, unitPrice: 12.5 }] });
      expect(created.status).toBe(201);
      const order = (await api<Priced>('GET', `/purchase-orders/${created.body.id}`)).body;
      expect(order).toMatchObject({ currency: 'ZAR', lines: [{ net: '43.13' }], totals: { subtotal: '37.50', vat: '5.63', net: '43.13', unpricedLines: 0 } });
      expect(Number(order.vatRate)).toBe(15);
    });

    it('adds a missing price and changes the VAT rate while the order is a draft', async () => {
      const created = await api<{ id: string }>('POST', '/purchase-orders', { supplierId, vatRate: 15, lines: [{ materialId, orderedQty: 4 }] });
      const lineId = (await api<Priced>('GET', `/purchase-orders/${created.body.id}`)).body.lines[0]!.id;
      const res = await api('PATCH', `/purchase-orders/${created.body.id}`, { vatRate: 0, linePrices: [{ lineId, unitPrice: 2.5 }] });
      expect(res.status).toBe(200);
      const order = (await api<Priced>('GET', `/purchase-orders/${created.body.id}`)).body;
      expect(order.totals).toEqual({ subtotal: '10.00', vat: '0.00', net: '10.00', unpricedLines: 0, discount: '0.00' });
    });

    // Discounts count toward Procurement's KPIs: kept on the line, off the totals.
    it('keeps a line discount, takes it off the totals, and changes it', async () => {
      const created = await api<{ id: string }>('POST', '/purchase-orders', { supplierId, vatRate: 15, lines: [{ materialId, orderedQty: 60, unitPrice: 95, discountPercent: 10 }] });
      expect(created.status).toBe(201);
      const order = (await api<Priced & { lines: Array<{ discountPercent: string; discount: string }> }>('GET', `/purchase-orders/${created.body.id}`)).body;
      expect(Number(order.lines[0]!.discountPercent)).toBe(10);
      expect(order.totals).toEqual({ subtotal: '5130.00', vat: '769.50', net: '5899.50', unpricedLines: 0, discount: '570.00' });

      const res = await api('PATCH', `/purchase-orders/${created.body.id}`, { lineDiscounts: [{ lineId: order.lines[0]!.id, discountPercent: 0 }] });
      expect(res.status).toBe(200);
      expect((await api<Priced>('GET', `/purchase-orders/${created.body.id}`)).body.totals).toMatchObject({ subtotal: '5700.00', discount: '0.00' });
    });

    it('refuses the same line discounted twice in one change', async () => {
      const created = await api<{ id: string }>('POST', '/purchase-orders', { supplierId, vatRate: 15, lines: [{ materialId, orderedQty: 1, unitPrice: 10 }] });
      const lineId = (await api<Priced>('GET', `/purchase-orders/${created.body.id}`)).body.lines[0]!.id;
      const res = await api('PATCH', `/purchase-orders/${created.body.id}`, { lineDiscounts: [{ lineId, discountPercent: 15 }, { lineId, discountPercent: 0 }] });
      expect(res.status).toBe(400);
    });

    it('refuses a discount over 100% or with more than 2 decimals', async () => {
      for (const discountPercent of [101, -1, 10.005]) {
        const res = await api('POST', '/purchase-orders', { supplierId, vatRate: 15, lines: [{ materialId, orderedQty: 1, unitPrice: 1, discountPercent }] });
        expect(res.status).toBe(400);
      }
    });

    it('refuses a VAT rate over 100', async () => {
      const res = await api('POST', '/purchase-orders', { supplierId, vatRate: 150, lines: [{ materialId, orderedQty: 1 }] });
      expect(res.status).toBe(400);
    });
  });

  describe('numbers and revisions', () => {
    it('numbers new orders AFRI-NNNN and raises the revision when an approved order changes', async () => {
      const order = await approvedOrder(2);
      const read = await api<{ number: string; revision: number }>('GET', `/purchase-orders/${order.id}`);
      expect(read.body.number).toMatch(/^AFRI-\d{4,}$/);
      expect(read.body.revision).toBe(0);
      expect((await api('PATCH', `/purchase-orders/${order.id}`, { shippingTerms: `Rev test ${run}` })).status).toBe(200);
      expect((await api<{ revision: number }>('GET', `/purchase-orders/${order.id}`)).body.revision).toBe(1);
    });
  });

  describe('approval by value', () => {
    it('signs by role and value: the Manager alone under R200 000 excluding VAT, then the Director too', async () => {
      const person = async (role: string, label: string) => {
        const email = `it-${label}-${run}@afrinov.local`;
        const password = `It-${run}-${label}`;
        const created = await api('POST', '/users', { email, name: `IT ${label} ${run}`, password, roleNames: [role] });
        expect(created.status).toBe(201);
        return client(server.port, await login(server.port, email, password));
      };
      const manager = await person('PROCUREMENT_MANAGER', 'manager');
      const director = await person('DIRECTOR', 'director');
      const ceo = await person('CEO', 'ceo');
      const oldApprover = await person('APPROVER', 'old-approver');

      const projectNumber = `IT-AV-${run}`;
      expect((await api('POST', '/projects', { projectNumber, name: `IT approval ${run}` })).status).toBe(201);
      const beam = await api<{ id: string }>('POST', '/materials', {
        sku: `IT-AV-BEAM-${run}`, name: `Integration beam ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'PC', projectNumber,
      });
      expect(beam.status).toBe(200);
      const order = async (price: number) => {
        const res = await api<{ id: string }>('POST', '/purchase-orders', { supplierId, projectNumber, vatRate: 15, lines: [{ materialId: beam.body.id, orderedQty: 1, unitPrice: price }] });
        await api('POST', `/purchase-orders/${res.body.id}/submit`);
        return res.body.id;
      };
      const small = await order(199999.99); // R229 999.99 with VAT: VAT doesn't count
      const large = await order(200000);
      // With approval switched off in Settings, submitting approves: nothing to check here.
      if ((await api<{ status: string }>('GET', `/purchase-orders/${small}`)).body.status !== 'PENDING_APPROVAL') return;

      // The old Approver role opens orders and signs none.
      expect((await oldApprover('GET', `/purchase-orders/${small}`)).status).toBe(200);
      expect((await oldApprover('POST', `/purchase-orders/${small}/approve`)).status).toBe(403);

      const signed = await manager<{ status: string }>('POST', `/purchase-orders/${small}/approve`);
      expect([signed.status, signed.body.status]).toEqual([200, 'APPROVED']);

      // The Director waits for the Manager, and only then sees the order.
      const waiting = async (who: typeof api) => (await who<Array<{ id: string }>>('GET', '/purchase-orders?awaitingMyApproval=true')).body.map((p) => p.id);
      expect(await waiting(director)).not.toContain(large);
      expect(await waiting(manager)).toContain(large);
      const early = await director<{ error: { message: string } }>('POST', `/purchase-orders/${large}/approve`);
      expect(early.status).toBe(403);
      expect(early.body.error.message).toMatch(/^The Procurement Manager signs this order first/);

      const first = await manager<{ status: string }>('POST', `/purchase-orders/${large}/approve`);
      expect([first.status, first.body.status]).toEqual([200, 'PENDING_APPROVAL']);
      const twice = await manager<{ error: { message: string } }>('POST', `/purchase-orders/${large}/approve`);
      expect(twice.status).toBe(403);
      expect(twice.body.error.message).toMatch(/^You have already signed this order/);
      expect(await waiting(director)).toContain(large);
      expect(await waiting(manager)).not.toContain(large);

      const view = await director<{ canApprove: boolean; randValue: string; next: { step: string }; steps: Array<{ step: string; signature: { standIn: boolean } | null }> }>('GET', `/purchase-orders/${large}/approval`);
      expect(view.body).toMatchObject({ canApprove: true, randValue: '200000.00', next: { step: 'DIRECTOR' }, steps: [{ step: 'MANAGER', signature: { standIn: false } }, { step: 'DIRECTOR', signature: null }] });

      // The CEO stands in for the Director, and the record says so.
      const last = await ceo<{ status: string }>('POST', `/purchase-orders/${large}/approve`);
      expect([last.status, last.body.status]).toEqual([200, 'APPROVED']);
      const final = await api<{ signatures: Array<{ step: string; standIn: boolean; signedBy: { name: string } }> }>('GET', `/purchase-orders/${large}`);
      expect(final.body.signatures).toMatchObject([
        { step: 'MANAGER', standIn: false, signedBy: { name: `IT manager ${run}` } },
        { step: 'DIRECTOR', standIn: true, signedBy: { name: `IT ceo ${run}` } },
      ]);
    });

    // Qodo, PR #155: a signature for the old money must not survive an edit made at the same moment.
    it('makes signing and editing the money take turns on the order', async () => {
      const email = `it-turns-${run}@afrinov.local`;
      const password = `It-${run}-turns`;
      expect((await api('POST', '/users', { email, name: `IT turns ${run}`, password, roleNames: ['PROCUREMENT_MANAGER'] })).status).toBe(201);
      const manager = client(server.port, await login(server.port, email, password));
      const approvalKey = '/settings/purchaseOrders.requireApprovalBeforeProcessing';
      const approvalWas = (await api<{ value: boolean }>('GET', approvalKey)).body.value;
      expect((await api('PUT', approvalKey, { value: true })).status).toBe(200);
      try {
        const projectNumber = `IT-TURN-${run}`;
        expect((await api('POST', '/projects', { projectNumber, name: `IT turns ${run}` })).status).toBe(201);
        const beam = await api<{ id: string }>('POST', '/materials', {
          sku: `IT-TURN-BEAM-${run}`, name: `Integration beam ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'PC', projectNumber,
        });
        const po = await api<{ id: string; lines: Array<{ id: string }> }>('POST', '/purchase-orders', { supplierId, projectNumber, lines: [{ materialId: beam.body.id, orderedQty: 1, unitPrice: 300000 }] });
        await api('POST', `/purchase-orders/${po.body.id}/submit`);

        // Holds the order's row, and checks the request waits for it.
        const waitsForTheOrder = async <T>(request: () => Promise<T>): Promise<T> => {
          let release!: () => void;
          let locked!: () => void;
          const held = new Promise<void>((r) => { release = r; });
          const acquired = new Promise<void>((r) => { locked = r; });
          const holder = prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT id FROM purchase_orders WHERE id = ${po.body.id} FOR UPDATE`;
            locked();
            await held;
          }, { timeout: 20000 });
          await acquired;
          let finished = false;
          const pending = request().then((r) => { finished = true; return r; });
          await new Promise((r) => setTimeout(r, 500));
          expect(finished).toBe(false);
          release();
          await holder;
          return pending;
        };

        const signed = await waitsForTheOrder(() => manager<{ status: string }>('POST', `/purchase-orders/${po.body.id}/approve`));
        expect([signed.status, signed.body.status]).toEqual([200, 'PENDING_APPROVAL']);
        const edited = await waitsForTheOrder(() => api('PATCH', `/purchase-orders/${po.body.id}`, { linePrices: [{ lineId: po.body.lines[0]!.id, unitPrice: 310000 }] }));
        expect(edited.status).toBe(200);
        const after = await api<{ signatures: unknown[] }>('GET', `/purchase-orders/${po.body.id}`);
        expect(after.body.signatures).toEqual([]);
      } finally {
        await api('PUT', approvalKey, { value: approvalWas });
      }
    });

    it('converts another currency at the rate locked on submission', async () => {
      const key = '/settings/purchaseOrders.exchangeRateUSD';
      const was = (await api<{ value: number }>('GET', key)).body.value;
      const approvalKey = '/settings/purchaseOrders.requireApprovalBeforeProcessing';
      const approvalWas = (await api<{ value: boolean }>('GET', approvalKey)).body.value;
      expect((await api('PUT', approvalKey, { value: true })).status).toBe(200);
      try {
        const usd = await api<{ id: string }>('POST', '/suppliers', { name: `IT USD ${run}`, currency: 'USD' });
        expect(usd.status).toBe(201);
        const order = await api<{ id: string }>('POST', '/purchase-orders', { supplierId: usd.body.id, lines: [{ materialId, orderedQty: 1, unitPrice: 100 }] });
        expect((await api('PUT', key, { value: 0 })).status).toBe(200);
        const refused = await api<{ error: { message: string } }>('POST', `/purchase-orders/${order.body.id}/submit`);
        expect(refused.status).toBe(400);
        expect(refused.body.error.message).toMatch(/no exchange rate for USD yet/);
        expect((await api('PUT', key, { value: 18.5 })).status).toBe(200);
        expect((await api('POST', `/purchase-orders/${order.body.id}/submit`)).status).toBe(200);
        expect((await api('PUT', key, { value: 25 })).status).toBe(200);
        const view = await api<{ exchangeRate: string; randValue: string }>('GET', `/purchase-orders/${order.body.id}/approval`);
        expect(view.body).toMatchObject({ exchangeRate: '18.5', randValue: '1850.00' });
      } finally {
        await api('PUT', key, { value: was });
        await api('PUT', approvalKey, { value: approvalWas });
      }
    });
  });

  describe('order details', () => {
    interface Detailed { id: string; projectNumber: string | null; deliveryMethod: string; deliveryTo: string | null; shippingTerms: string | null; penaltiesApply: boolean; lines: Array<{ id: string; deliveryDate: string | null }> }

    it('keeps the project, terms and a line delivery date, and filters by project', async () => {
      const project = await api<{ projectNumber: string }>('POST', '/projects', { projectNumber: `IT-PO-${run}`, name: `IT project ${run}` });
      expect([200, 201]).toContain(project.status);
      const beam = await api<{ id: string }>('POST', '/materials', {
        sku: `IT-PO-BEAM-${run}`, name: `Integration beam ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'PC', projectNumber: `IT-PO-${run}`,
      });
      expect(beam.status).toBe(200);
      const created = await api<{ id: string }>('POST', '/purchase-orders', {
        supplierId, projectNumber: `IT-PO-${run}`, shippingTerms: 'Delivered to site', penaltiesApply: true,
        lines: [{ materialId: beam.body.id, orderedQty: 2, deliveryDate: '2026-11-02' }],
      });
      expect(created.status).toBe(201);
      const order = (await api<Detailed>('GET', `/purchase-orders/${created.body.id}`)).body;
      expect(order).toMatchObject({ projectNumber: `IT-PO-${run}`, shippingTerms: 'Delivered to site', penaltiesApply: true, deliveryMethod: 'DELIVERY' });
      expect(order.lines[0]!.deliveryDate?.slice(0, 10)).toBe('2026-11-02');
      const listed = (await api<Detailed[]>('GET', `/purchase-orders?projectNumber=IT-PO-${run}`)).body;
      expect(listed.map((o) => o.id)).toEqual([created.body.id]);
    });

    it('refuses an unknown project', async () => {
      const res = await api<{ error: { code: string } }>('POST', '/purchase-orders', { supplierId, projectNumber: `NOPE-${run}`, lines: [{ materialId, orderedQty: 1 }] });
      expect(res.status).toBe(400);
    });

    it('clears a detail and changes a line delivery date', async () => {
      const created = await api<{ id: string }>('POST', '/purchase-orders', { supplierId, shippingTerms: 'FOB', lines: [{ materialId, orderedQty: 1 }] });
      const lineId = (await api<Detailed>('GET', `/purchase-orders/${created.body.id}`)).body.lines[0]!.id;
      const res = await api('PATCH', `/purchase-orders/${created.body.id}`, { shippingTerms: null, lineDeliveryDates: [{ lineId, deliveryDate: '2026-12-01' }] });
      expect(res.status).toBe(200);
      const order = (await api<Detailed>('GET', `/purchase-orders/${created.body.id}`)).body;
      expect(order.shippingTerms).toBeNull();
      expect(order.lines[0]!.deliveryDate?.slice(0, 10)).toBe('2026-12-01');
    });
  });

  // As the template's Inputs sheet: the supplier's contact and address fill a
  // new order, and are changed on the order without touching the supplier.
  describe('supplier details on an order', () => {
    interface WithSupplierDetails { id: string; supplierContactName: string | null; supplierContactPhone: string | null; supplierContactEmail: string | null; supplierAddress: string | null }

    it('copies them from the supplier, and keeps changes to this order', async () => {
      const supplier = await api<{ id: string }>('POST', '/suppliers', {
        name: `IT Supplier details ${run}`, contactName: 'Nicole', contactPhone: '011 452 8413', contactEmail: 'nicole@example.com', address: '23 Grader Road',
      });
      expect(supplier.status).toBe(201);
      const created = await api<WithSupplierDetails>('POST', '/purchase-orders', { supplierId: supplier.body.id, lines: [{ materialId, orderedQty: 1 }] });
      expect([200, 201]).toContain(created.status);
      expect(created.body).toMatchObject({ supplierContactName: 'Nicole', supplierContactPhone: '011 452 8413', supplierContactEmail: 'nicole@example.com', supplierAddress: '23 Grader Road' });

      expect((await api('PATCH', `/purchase-orders/${created.body.id}`, { supplierContactName: 'Sean', supplierContactPhone: null })).status).toBe(200);
      const order = (await api<WithSupplierDetails>('GET', `/purchase-orders/${created.body.id}`)).body;
      expect(order).toMatchObject({ supplierContactName: 'Sean', supplierContactPhone: null, supplierAddress: '23 Grader Road' });
      expect((await api<{ contactName: string }>('GET', `/suppliers/${supplier.body.id}`)).body.contactName).toBe('Nicole');

      const bad = await api('PATCH', `/purchase-orders/${created.body.id}`, { supplierContactEmail: 'not-an-email' });
      expect(bad.status).toBe(400);
    });
  });

  // Each delivery goes on the order's Activity with the transition it made.
  describe('order Activity', () => {
    // Deliveries for different lines: without the order locked, each saw only
    // its own line received, so both recorded Approved → Partly received and
    // the order stayed Partly received with everything delivered.
    it('records two deliveries posted at once as one transition each, in turn', async () => {
      const other = await api<{ id: string }>('POST', '/materials', {
        sku: `IT-PO2-${run}`, name: `Integration gland ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each',
      });
      expect(other.status).toBe(200);
      const created = await api<PurchaseOrder>('POST', '/purchase-orders', {
        supplierId,
        lines: [{ materialId, orderedQty: 1, unitPrice: 12.5 }, { materialId: other.body.id, orderedQty: 1, unitPrice: 3 }],
      });
      expect(created.status).toBe(201);
      const submitted = await api<PurchaseOrder>('POST', `/purchase-orders/${created.body.id}/submit`);
      if (submitted.body.status === 'PENDING_APPROVAL') await checker('POST', `/purchase-orders/${created.body.id}/approve`);
      const order = (await api<PurchaseOrder>('GET', `/purchase-orders/${created.body.id}`)).body;
      expect(order.status).toBe('APPROVED');

      const receipts = await Promise.all(order.lines.map(async (line) => (await api<GoodsReceipt>('POST', '/goods-receipts', {
        purchaseOrderId: order.id, supplierId,
        lines: [{ materialId: line.materialId, locationId, quantity: 1, purchaseOrderLineId: line.id }],
      })).body));

      const posted = await Promise.all(receipts.map((r) => api('POST', `/goods-receipts/${r.id}/post`)));
      expect(posted.map((p) => p.status)).toEqual([200, 200]);
      expect((await getOrder(order.id)).status).toBe('RECEIVED');

      const history = await api<Array<{ action: string; actorName: string | null; before: { status: string }; after: { status: string } }>>('GET', `/purchase-orders/${order.id}/history`);
      const deliveries = history.body.filter((e) => e.action === 'PO_GOODS_RECEIVED');
      // Whichever posted first moved it to Partly received, the other on to Received.
      expect(deliveries.map((e) => `${e.before.status}>${e.after.status}`).sort()).toEqual([
        'APPROVED>PARTIALLY_RECEIVED',
        'PARTIALLY_RECEIVED>RECEIVED',
      ]);
      expect(history.body.at(-1)).toMatchObject({ action: 'CREATE' });
      expect(history.body.every((e) => e.actorName)).toBe(true);
    });
  });

  // Receive delivery records and posts a receipt in one step. Receipts that
  // arrive together must each be counted in the balance, and none may fail.
  describe('one-step receipts at the same time', () => {
    it('records and posts each, and the balance counts every one', async () => {
      const orders = await Promise.all([1, 2, 3, 4].map(() => approvedOrder(1)));
      const { ledger: before } = await ledgerAndBalance(materialId, locationId);

      const results = await Promise.all(orders.map((order) => api<{ status: string; number: string }>('POST', '/goods-receipts', {
        purchaseOrderId: order.id,
        supplierId,
        lines: [{ materialId, locationId, quantity: 1, purchaseOrderLineId: order.lines[0]!.id }],
        post: true,
      })));

      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect(results.map((r) => r.body.status)).toEqual(['POSTED', 'POSTED', 'POSTED', 'POSTED']);
      expect(new Set(results.map((r) => r.body.number)).size).toBe(4);
      await expectStock(String(Number(before) + 4));
      for (const order of orders) expect((await getOrder(order.id)).status).toBe('RECEIVED');
    });

    // Receive stock once locked the item's balance before the receipt number,
    // and a receipt against an order the other way round, so the two could
    // deadlock (Postgres aborted one: "deadlock detected"). Every receiving
    // path now locks the number first. With procurement on, a delivery is
    // always against an order, so the two ways in are a receipt against an
    // order and receiving a whole order. Twelve of each, as fewer rarely overlap.
    it('posts receipts against orders and whole-order receipts for one item at once, none failing', async () => {
      const each = 12;
      const orders = await Promise.all(Array.from({ length: each * 2 }, () => approvedOrder(1)));
      const { ledger: before } = await ledgerAndBalance(materialId, locationId);

      const results = await Promise.all([
        ...orders.slice(0, each).map((order) => api('POST', '/goods-receipts', {
          purchaseOrderId: order.id, supplierId,
          lines: [{ materialId, locationId, quantity: 1, purchaseOrderLineId: order.lines[0]!.id }],
          post: true,
        })),
        ...orders.slice(each).map((order) => api('POST', `/purchase-orders/${order.id}/receive`, { locationId })),
      ]);

      expect(results.map((r) => r.status)).toEqual([...Array(each).fill(201), ...Array(each).fill(200)]);
      await expectStock(String(Number(before) + each * 2));
    });
  });

  // The supplier accepts the order's terms, so an approved order keeps the
  // wording it was approved with.
  describe('small print', () => {
    it('keeps the wording an order was approved with when the settings change later', async () => {
      const original = (await api<{ value: string }>('GET', '/settings/purchaseOrders.terms')).body.value;
      try {
        expect((await api('PUT', '/settings/purchaseOrders.terms', { value: `Terms as approved ${run}.` })).status).toBe(200);
        const order = await approvedOrder(1);
        const kept = await api<{ printedTerms: Record<string, string> | null }>('GET', `/purchase-orders/${order.id}`);
        expect(kept.body.printedTerms).toMatchObject({ terms: `Terms as approved ${run}.`, invoiceEmail: expect.any(String) });

        expect((await api('PUT', '/settings/purchaseOrders.terms', { value: `Changed later ${run}.` })).status).toBe(200);
        const after = await api<{ printedTerms: Record<string, string> | null }>('GET', `/purchase-orders/${order.id}`);
        expect(after.body.printedTerms?.terms).toBe(`Terms as approved ${run}.`);
      } finally {
        await api('PUT', '/settings/purchaseOrders.terms', { value: original });
      }
    });
  });

  // Stores ordering roadmap, Phase 1: Procurement buys for projects, the
  // store orders Stores stock, and the server holds each to its own kind.
  describe('Stores and project orders', () => {
    const projectNumber = `IT-SO-${run}`;
    let beamId: string;
    let storeman: ReturnType<typeof client>;
    let buyer: ReturnType<typeof client>;

    // Each call signs in a new user, so a role can be used in more than one test.
    let users = 0;
    async function as(role: string) {
      const email = `it-so-${role.toLowerCase()}-${++users}-${run}@afrinov.local`;
      const password = `It-${run}-${role.toLowerCase()}`;
      expect((await api('POST', '/users', { email, name: `IT SO ${role} ${run}`, password, roleNames: [role] })).status).toBe(201);
      return client(server.port, await login(server.port, email, password));
    }

    beforeAll(async () => {
      expect((await api('POST', '/projects', { projectNumber, name: `IT stores ordering ${run}` })).status).toBe(201);
      const beam = await api<{ id: string }>('POST', '/materials', {
        sku: `IT-SO-BEAM-${run}`, name: `Integration beam ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'PC', projectNumber,
      });
      expect(beam.status).toBe(200);
      beamId = beam.body.id;
      storeman = await as('STORE_CONTROLLER');
      buyer = await as('PROCUREMENT');
    });

    const storesOrder = () => ({ supplierId, lines: [{ materialId, orderedQty: 3, unitPrice: 12.5 }] });
    const projectOrder = () => ({ supplierId, projectNumber, lines: [{ materialId: beamId, orderedQty: 2 }] });

    it('lets the storeman raise, edit, submit and cancel a Stores order, and no project order', async () => {
      const created = await storeman<{ id: string; projectNumber: string | null }>('POST', '/purchase-orders', storesOrder());
      expect(created.status).toBe(201);
      expect(created.body.projectNumber).toBeNull();
      expect((await storeman('PATCH', `/purchase-orders/${created.body.id}`, { notes: 'Shelf B2' })).status).toBe(200);
      expect((await storeman('POST', `/purchase-orders/${created.body.id}/submit`)).status).toBe(200);
      expect((await storeman('POST', `/purchase-orders/${created.body.id}/cancel`, { reason: 'Ordered twice' })).status).toBe(200);

      expect((await storeman('POST', '/purchase-orders', projectOrder())).status).toBe(403);
      // A project order is Procurement's: to the store it is not found (Stores
      // and Procurement Separation Roadmap, Phase 4), whichever way it is asked for.
      const theirs = await buyer<{ id: string }>('POST', '/purchase-orders', projectOrder());
      for (const [method, path, body] of [
        ['GET', `/purchase-orders/${theirs.body.id}`, undefined],
        ['GET', `/purchase-orders/${theirs.body.id}/history`, undefined],
        ['PATCH', `/purchase-orders/${theirs.body.id}`, { notes: 'Not mine' }],
        ['POST', `/purchase-orders/${theirs.body.id}/submit`, undefined],
        ['POST', `/purchase-orders/${theirs.body.id}/cancel`, { reason: 'Not mine' }],
        ['POST', `/purchase-orders/${theirs.body.id}/close`, {}],
      ] as const) {
        expect([method, path, (await storeman(method, path, body)).status]).toEqual([method, path, 404]);
      }
      const listed = (await storeman<Array<{ id: string; projectNumber: string | null }>>('GET', '/purchase-orders')).body;
      expect(listed.map((o) => o.id)).not.toContain(theirs.body.id);
      expect(listed.every((o) => o.projectNumber === null)).toBe(true);
      expect((await storeman<unknown[]>('GET', '/purchase-orders?kind=projects')).body).toEqual([]);
      // A Stores order is the store's alone (Stores and Procurement Separation
      // Roadmap, Phase 2): to a buyer it is not found, in any way of opening it.
      for (const path of [`/purchase-orders/${created.body.id}`, `/purchase-orders/${created.body.id}/history`, `/purchase-orders/${created.body.id}/approval`]) {
        expect([path, (await buyer('GET', path)).status]).toEqual([path, 404]);
      }
      expect((await storeman('GET', `/purchase-orders/${created.body.id}`)).status).toBe(200);
    });

    it('lets a buyer raise a project order, and no Stores order', async () => {
      expect((await buyer('POST', '/purchase-orders', projectOrder())).status).toBe(201);
      expect((await buyer('POST', '/purchase-orders', storesOrder())).status).toBe(403);
      const theirs = await storeman<{ id: string }>('POST', '/purchase-orders', storesOrder());
      // Not found, rather than refused, so a buyer can't tell a Stores order exists.
      expect((await buyer('PATCH', `/purchase-orders/${theirs.body.id}`, { notes: 'Not mine' })).status).toBe(404);
      expect((await buyer('POST', `/purchase-orders/${theirs.body.id}/submit`)).status).toBe(404);
      expect((await buyer('POST', `/purchase-orders/${theirs.body.id}/cancel`, { reason: 'Not mine' })).status).toBe(404);
    });

    it("lists a buyer no Stores order, even when asked for them", async () => {
      const store = await storeman<{ id: string }>('POST', '/purchase-orders', storesOrder());
      const listed = (await buyer<Array<{ id: string; projectNumber: string | null }>>('GET', '/purchase-orders')).body;
      expect(listed.map((o) => o.id)).not.toContain(store.body.id);
      expect(listed.every((o) => o.projectNumber !== null)).toBe(true);
      expect((await buyer<unknown[]>('GET', '/purchase-orders?kind=stores')).body).toEqual([]);
      // The store lists its own.
      expect((await storeman<Array<{ id: string }>>('GET', '/purchase-orders?kind=stores')).body.map((o) => o.id)).toContain(store.body.id);
    });

    it('keeps Stores items off a project order, and neither kind becomes the other', async () => {
      const mixed = await api<{ error: { message: string } }>('POST', '/purchase-orders', {
        supplierId, projectNumber, lines: [{ materialId: beamId, orderedQty: 1 }, { materialId, orderedQty: 1 }],
      });
      expect(mixed.status).toBe(400);
      expect(mixed.body.error.message).toMatch(/is a Stores item, so it isn't bought for project/);

      const project = await api<{ id: string }>('POST', '/purchase-orders', projectOrder());
      expect((await api('PATCH', `/purchase-orders/${project.body.id}`, { projectNumber: null })).status).toBe(400);
      const store = await api<{ id: string }>('POST', '/purchase-orders', storesOrder());
      expect((await api('PATCH', `/purchase-orders/${store.body.id}`, { projectNumber })).status).toBe(400);
    });

    it('lists each kind on its own', async () => {
      const store = await storeman<{ id: string }>('POST', '/purchase-orders', storesOrder());
      const project = await buyer<{ id: string }>('POST', '/purchase-orders', projectOrder());
      const kind = async (k: string) => (await api<Array<{ id: string; projectNumber: string | null }>>('GET', `/purchase-orders?kind=${k}`)).body;
      const storesList = await kind('stores');
      expect(storesList.map((o) => o.id)).toContain(store.body.id);
      expect(storesList.every((o) => o.projectNumber === null)).toBe(true);
      const projectsList = await kind('projects');
      expect(projectsList.map((o) => o.id)).toContain(project.body.id);
      expect(projectsList.every((o) => o.projectNumber !== null)).toBe(true);
      expect((await api('GET', '/purchase-orders?kind=shelf')).status).toBe(400);
    });

    it('refuses someone who orders neither kind before looking the order up', async () => {
      const viewer = await as('APPROVER');
      expect((await viewer('PATCH', '/purchase-orders/00000000-0000-4000-8000-000000000000', { notes: 'x' })).status).toBe(403);
      expect((await storeman('PATCH', '/purchase-orders/00000000-0000-4000-8000-000000000000', { notes: 'x' })).status).toBe(404);
    });

    // Phase 4: every role end to end.
    // Who signs which kind of order (po-approval.ts).
    it('has the Procurement Manager sign both kinds, the Director only project orders, and the store neither', async () => {
      const approvalKey = '/settings/purchaseOrders.requireApprovalBeforeProcessing';
      const approvalWas = (await api<{ value: boolean }>('GET', approvalKey)).body.value;
      expect((await api('PUT', approvalKey, { value: true })).status).toBe(200);
      try {
        const manager = await as('PROCUREMENT_MANAGER');
        const director = await as('DIRECTOR');
        const workshop = await as('WORKSHOP_MANAGER');
        const raiseStores = async () => {
          const made = await storeman<{ id: string }>('POST', '/purchase-orders', storesOrder());
          expect((await storeman<{ status: string }>('POST', `/purchase-orders/${made.body.id}/submit`)).body.status).toBe('PENDING_APPROVAL');
          return made.body.id;
        };
        const store = await raiseStores();
        const project = await buyer<{ id: string }>('POST', '/purchase-orders', { ...projectOrder(), lines: [{ materialId: beamId, orderedQty: 2, unitPrice: 40 }] });
        expect((await buyer<{ status: string }>('POST', `/purchase-orders/${project.body.id}/submit`)).body.status).toBe('PENDING_APPROVAL');

        const waiting = async (who: typeof api) => (await who<Array<{ id: string }>>('GET', '/purchase-orders?awaitingMyApproval=true')).body.map((o) => o.id);
        expect(await waiting(manager)).toEqual(expect.arrayContaining([store, project.body.id]));
        expect(await waiting(storeman)).not.toContain(store);
        expect(await waiting(director)).not.toContain(store);

        // The store raises its orders and doesn't sign them; the Director doesn't even find one.
        expect((await storeman('POST', `/purchase-orders/${store}/approve`)).status).toBe(403);
        expect((await storeman('POST', `/purchase-orders/${project.body.id}/approve`)).status).toBe(403);
        expect((await director('POST', `/purchase-orders/${store}/approve`)).status).toBe(404);
        // Those who sign Stores orders can't change them.
        expect((await manager('PATCH', `/purchase-orders/${store}`, { notes: 'x' })).status).toBe(403);

        const storeApproved = await manager<{ status: string }>('POST', `/purchase-orders/${store}/approve`);
        expect([storeApproved.status, storeApproved.body.status]).toEqual([200, 'APPROVED']);
        const projectApproved = await manager<{ status: string }>('POST', `/purchase-orders/${project.body.id}/approve`);
        expect([projectApproved.status, projectApproved.body.status]).toEqual([200, 'APPROVED']);

        // The Workshop Manager stands in on a Stores order.
        const covered = await raiseStores();
        expect((await workshop<{ status: string }>('POST', `/purchase-orders/${covered}/approve`)).body.status).toBe('APPROVED');

        expect((await manager('POST', '/purchase-orders', storesOrder())).status).toBe(403);
        expect((await manager('POST', '/purchase-orders', projectOrder())).status).toBe(403);
      } finally {
        await api('PUT', approvalKey, { value: approvalWas });
      }
    });

    // Segregation of duties: whoever raised an order never signs it, whatever
    // their role; another holder of the role does.
    it("won't let anyone sign an order they raised", async () => {
      const approvalKey = '/settings/purchaseOrders.requireApprovalBeforeProcessing';
      const approvalWas = (await api<{ value: boolean }>('GET', approvalKey)).body.value;
      expect((await api('PUT', approvalKey, { value: true })).status).toBe(200);
      try {
        // The admin holds the Procurement Manager's role, so could otherwise sign it.
        const own = await api<{ id: string }>('POST', '/purchase-orders', storesOrder());
        expect((await api<{ status: string }>('POST', `/purchase-orders/${own.body.id}/submit`)).body.status).toBe('PENDING_APPROVAL');
        expect((await api<Array<{ id: string }>>('GET', '/purchase-orders?awaitingMyApproval=true')).body.map((o) => o.id)).not.toContain(own.body.id);
        const panel = (await api<{ canApprove: boolean; reason: string; approvers: Array<{ name: string }> }>('GET', `/purchase-orders/${own.body.id}/approval`)).body;
        expect(panel).toMatchObject({ canApprove: false, reason: 'You raised this order, so someone else must sign it.' });
        expect(panel.approvers.map((a) => a.name)).not.toContain('System Administrator');
        const refused = await api<{ error: { message: string } }>('POST', `/purchase-orders/${own.body.id}/approve`);
        expect(refused.status).toBe(403);
        expect(refused.body.error.message).toMatch(/^You raised this order, so someone else must sign it\. Ask .*IT Checker/);
        expect((await checker<{ status: string }>('POST', `/purchase-orders/${own.body.id}/approve`)).body.status).toBe('APPROVED');
      } finally {
        await api('PUT', approvalKey, { value: approvalWas });
      }
    });

    it("keeps project orders' Activity out of the store's audit log, and the store's out of Procurement's", async () => {
      const project = await buyer<{ id: string }>('POST', '/purchase-orders', projectOrder());
      const store = await storeman<{ id: string }>('POST', '/purchase-orders', storesOrder());
      const entries = async (who: typeof api, id: string) => (await who<Array<{ entityId: string }>>('GET', `/audit?entityType=PurchaseOrder&entityId=${id}`)).body;
      expect(await entries(storeman, project.body.id)).toEqual([]);
      expect(await entries(storeman, store.body.id)).not.toEqual([]);
      // Admin sees both.
      expect(await entries(api, project.body.id)).not.toEqual([]);
      // With no filter either.
      const all = (await storeman<Array<{ entityId: string }>>('GET', '/audit?limit=500')).body.map((e) => e.entityId);
      expect(all).not.toContain(project.body.id);
      // Entries come back as they did: newest first, within the limit asked for.
      const page = (await api<Array<{ createdAt: string; entityType: string }>>('GET', '/audit?limit=3')).body;
      expect(page.length).toBeLessThanOrEqual(3);
      expect([...page].sort((x, y) => y.createdAt.localeCompare(x.createdAt))).toEqual(page);
    });

    // Qodo, PR #122: a role with the audit log but neither kind of order sees no order's Activity.
    it("shows no order's Activity to someone who reads the audit log but sees neither kind", async () => {
      const store = await storeman<{ id: string }>('POST', '/purchase-orders', storesOrder());
      const project = await buyer<{ id: string }>('POST', '/purchase-orders', projectOrder());
      // Roles are a fixed list, so VIEWER (neither order permission) is given the audit log
      // for this test only; integration files run one at a time, and it is taken back after.
      const viewer = await prisma.role.findUniqueOrThrow({ where: { name: 'VIEWER' } });
      const viewAudit = await prisma.permission.findUniqueOrThrow({ where: { code: 'view:audit_log' } });
      const grant = { roleId_permissionId: { roleId: viewer.id, permissionId: viewAudit.id } };
      await prisma.rolePermission.upsert({ where: grant, update: {}, create: { roleId: viewer.id, permissionId: viewAudit.id } });
      try {
        const reader = await as('VIEWER');
        const seen = (await reader<Array<{ entityType: string; entityId: string }>>('GET', '/audit?limit=500')).body;
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.some((e) => e.entityType === 'PurchaseOrder')).toBe(false);
        expect(seen.map((e) => e.entityId)).not.toContain(store.body.id);
        expect(seen.map((e) => e.entityId)).not.toContain(project.body.id);
      } finally {
        await prisma.rolePermission.delete({ where: grant });
      }
    });

    it.each(['TECHNICIAN', 'VIEWER'])('lets a %s raise neither kind, nor open one', async (role) => {
      const user = await as(role);
      const store = await storeman<{ id: string }>('POST', '/purchase-orders', storesOrder());
      expect((await user('POST', '/purchase-orders', storesOrder())).status).toBe(403);
      expect((await user('POST', '/purchase-orders', projectOrder())).status).toBe(403);
      expect((await user('PATCH', `/purchase-orders/${store.body.id}`, { notes: 'x' })).status).toBe(403);
      expect((await user('GET', `/purchase-orders/${store.body.id}`)).status).toBe(403);
      expect((await user('GET', '/purchase-orders?kind=stores')).status).toBe(403);
    });

    // Project Material Through the Store Roadmap, Phase 2: project material
    // comes through the store. The store receives a project order into stock
    // held for its project, seeing only what receiving needs; Procurement's
    // Confirm delivery is retired.
    describe('delivery of a project order', () => {
      interface Lined { id: string; status: string; lines: Array<{ id: string; orderedQty: string; receivedQty: string }> }

      /** A project order for 4 beams (or as many as given), approved. */
      async function approvedProjectOrder(orderedQty = 4): Promise<Lined> {
        const created = await buyer<{ id: string }>('POST', '/purchase-orders', { ...projectOrder(), lines: [{ materialId: beamId, orderedQty, unitPrice: 40 }] });
        expect(created.status).toBe(201);
        const submitted = await buyer<{ status: string }>('POST', `/purchase-orders/${created.body.id}/submit`);
        if (submitted.body.status === 'PENDING_APPROVAL') expect((await api('POST', `/purchase-orders/${created.body.id}/approve`)).status).toBe(200);
        const order = (await api<Lined>('GET', `/purchase-orders/${created.body.id}`)).body;
        expect(order.status).toBe('APPROVED');
        return order;
      }
      const receive = (who: typeof api, order: Lined, quantity: number) => who<{ id: string; number: string; error?: { message: string } }>('POST', '/goods-receipts', {
        purchaseOrderId: order.id, supplierId, deliveryRef: `DN-${run}`, post: true,
        lines: [{ materialId: beamId, locationId, quantity, purchaseOrderLineId: order.lines[0]!.id }],
      });
      const held = async () => ledgerAndBalance(beamId, locationId, projectNumber);

      it('lets the store receive it, part then the rest, into stock held for the project', async () => {
        const order = await approvedProjectOrder();
        const before = await held();
        const stores = await ledgerAndBalance(beamId, locationId);

        const part = await receive(storeman, order, 1.5);
        expect(part.status).toBe(201);
        expect((await api<Lined>('GET', `/purchase-orders/${order.id}`)).body.status).toBe('PARTIALLY_RECEIVED');
        expect((await receive(storeman, order, 2.5)).status).toBe(201);
        expect((await api<Lined>('GET', `/purchase-orders/${order.id}`)).body.status).toBe('RECEIVED');

        // Held for the project, its balance in step with the ledger; Stores stock untouched.
        const after = await held();
        expect(Number(after.ledger) - Number(before.ledger)).toBe(4);
        expect(after.balance).toBe(after.ledger);
        expect(await ledgerAndBalance(beamId, locationId)).toEqual(stores);
        const movements = await prisma.inventoryTransaction.findMany({ where: { referenceType: 'GoodsReceipt', referenceId: part.body.id } });
        expect(movements.map((m) => m.heldForProject)).toEqual([projectNumber]);
        // Current stock says whose it is.
        const rows = (await api<Array<{ materialId: string; locationId: string; heldForProject: string | null; quantity: string }>>('GET', `/reports/current-stock?materialId=${beamId}`)).body;
        expect(rows.find((r) => r.locationId === locationId && r.heldForProject === projectNumber)?.quantity).toBe(after.balance);

        // The store sees its receipt; Procurement closes the order.
        expect((await storeman<Array<{ id: string }>>('GET', '/goods-receipts')).body.map((r) => r.id)).toContain(part.body.id);
        expect((await storeman('GET', `/goods-receipts/${part.body.id}`)).status).toBe(200);
        expect((await buyer<{ status: string }>('POST', `/purchase-orders/${order.id}/close`, {})).body.status).toBe('CLOSED');
      });

      it('shows the store a receiving view of it: the project, lines and what is owed, no prices', async () => {
        const order = await approvedProjectOrder();
        const listed = (await storeman<Array<Record<string, unknown> & { id: string; lines: Array<Record<string, unknown>> }>>('GET', '/purchase-orders/receivable')).body;
        const mine = listed.find((o) => o.id === order.id)!;
        expect(mine).toMatchObject({ projectNumber, status: 'APPROVED', supplierId });
        expect(mine.lines[0]).toMatchObject({ id: order.lines[0]!.id, orderedQty: '4', receivedQty: '0' });
        expect(mine.lines[0]).not.toHaveProperty('unitPrice');
        expect(mine).not.toHaveProperty('totals');
        // Its own orders are there too.
        const store = await approvedOrder(2);
        expect((await storeman<Array<{ id: string }>>('GET', '/purchase-orders/receivable')).body.map((o) => o.id)).toContain(store.id);
        // The order itself stays Procurement's: not found to the store.
        expect((await storeman('GET', `/purchase-orders/${order.id}`)).status).toBe(404);
        expect((await storeman('GET', `/purchase-orders/${order.id}/history`)).status).toBe(404);
        // The buyer receives neither kind, so lists nothing to receive.
        expect((await buyer<Array<{ id: string }>>('GET', '/purchase-orders/receivable')).body).toEqual([]);
      });

      it('keeps the buyer from receiving it, and no longer confirms a delivery on the order', async () => {
        const order = await approvedProjectOrder();
        // The buyer sees the order, so is refused, not told it is missing.
        expect((await receive(buyer, order, 1)).status).toBe(403);
        expect((await buyer('POST', `/purchase-orders/${order.id}/receive`, { locationId })).status).toBe(403);
        const confirm = await buyer<{ error: { message: string } }>('POST', `/purchase-orders/${order.id}/confirm-delivery`, { lines: [{ lineId: order.lines[0]!.id, quantity: 1 }] });
        expect(confirm.status).toBe(400);
        expect(confirm.body.error.message).toMatch(/received into stock now: the store books each delivery on Receive stock/);
        expect((await api<Lined>('GET', `/purchase-orders/${order.id}`)).body.status).toBe('APPROVED');
        expect(await prisma.inventoryTransaction.count({ where: { referenceId: order.id } })).toBe(0);
      });

      it('receives the rest of it whole with Receive, held for the project', async () => {
        const order = await approvedProjectOrder();
        const before = await held();
        expect((await receive(storeman, order, 1)).status).toBe(201);
        const whole = await storeman<{ status: string }>('POST', `/purchase-orders/${order.id}/receive`, { locationId });
        expect(whole.status).toBe(200);
        expect(whole.body.status).toBe('RECEIVED');
        expect(Number((await held()).ledger) - Number(before.ledger)).toBe(4);
        const rest = await prisma.inventoryTransaction.findMany({ where: { referenceType: 'PurchaseOrder', referenceId: order.id } });
        expect(rest.map((m) => [m.quantity.toString(), m.heldForProject])).toEqual([['3', projectNumber]]);
      });

      it('posts a receipt saved against it before, into the project\'s stock', async () => {
        const order = await approvedProjectOrder();
        const before = await held();
        const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
        const saved = await prisma.goodsReceipt.create({
          data: {
            number: `GR-IT-${run}`, purchaseOrderId: order.id, supplierId, receivedById: admin.id, status: 'SUBMITTED',
            lines: { create: [{ materialId: beamId, locationId, quantity: 1, purchaseOrderLineId: order.lines[0]!.id }] },
          },
        });
        expect((await storeman('POST', `/goods-receipts/${saved.id}/post`)).status).toBe(200);
        expect(Number((await held()).ledger) - Number(before.ledger)).toBe(1);
        expect((await api<Lined>('GET', `/purchase-orders/${order.id}`)).body.status).toBe('PARTIALLY_RECEIVED');
      });

      // Project Material Through the Store Roadmap, Phase 3: a project's own
      // stock goes to that project only, from the stock each line names.
      describe("issuing and moving a project's own stock", () => {
        let recipientId: string;
        let looseId: string;
        const other = `IT-SO-OTHER-${run}`;

        beforeAll(async () => {
          const rcp = await api<{ id: string }>('POST', '/recipients', { name: `IT project fitter ${run}`, type: 'WORKER' });
          expect(rcp.status).toBe(201);
          recipientId = rcp.body.id;
          expect((await api('POST', '/projects', { projectNumber: other, name: `IT other project ${run}` })).status).toBe(201);
          // A Projects item with no project of its own: the order says whose it is.
          const loose = await api<{ id: string }>('POST', '/materials', {
            sku: `IT-SO-LOOSE-${run}`, name: `Integration loose plate ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'M',
          });
          expect(loose.status).toBe(200);
          looseId = loose.body.id;
        });

        /** Receives 4 of an item for the project into stock held for it. */
        async function receivedForProject(itemId: string) {
          const created = await buyer<{ id: string }>('POST', '/purchase-orders', { supplierId, projectNumber, lines: [{ materialId: itemId, orderedQty: 4, unitPrice: 40 }] });
          expect(created.status).toBe(201);
          const submitted = await buyer<{ status: string }>('POST', `/purchase-orders/${created.body.id}/submit`);
          if (submitted.body.status === 'PENDING_APPROVAL') expect((await api('POST', `/purchase-orders/${created.body.id}/approve`)).status).toBe(200);
          expect((await storeman('POST', `/purchase-orders/${created.body.id}/receive`, { locationId })).status).toBe(200);
        }
        const issue = (projectFor: string | undefined, heldForProject: string | null, quantity: number) =>
          storeman<{ transactionIds: string[]; error?: { message: string } }>('POST', '/inventory-issues', {
            recipientId, projectNumber: projectFor, lines: [{ materialId: looseId, locationId, quantity, heldForProject }],
          });

        it('issues it to its project only, and a return puts it back', async () => {
          await receivedForProject(looseId);
          const before = await ledgerAndBalance(looseId, locationId, projectNumber);

          // Not to another project, nor to none.
          const toOther = await issue(other, projectNumber, 1);
          expect(toOther.status).toBe(400);
          expect(toOther.body.error!.message).toMatch(new RegExp(`held for project ${projectNumber}, so it can't be issued to project ${other}`));
          expect((await issue(undefined, projectNumber, 1)).status).toBe(400);
          // Nor taken as Stores stock: an item with no project isn't issued from there.
          expect((await issue(projectNumber, null, 1)).status).toBe(400);
          expect(await ledgerAndBalance(looseId, locationId, projectNumber)).toEqual(before);

          // To its project, from its stock, though the item itself has no project.
          const issued = await issue(projectNumber, projectNumber, 1.5);
          expect(issued.status).toBe(201);
          const [movement] = await prisma.inventoryTransaction.findMany({ where: { id: { in: issued.body.transactionIds } } });
          expect([movement!.heldForProject, movement!.projectNumber, movement!.quantity.toString()]).toEqual([projectNumber, projectNumber, '-1.5']);
          const after = await ledgerAndBalance(looseId, locationId, projectNumber);
          expect(Number(before.ledger) - Number(after.ledger)).toBe(1.5);
          expect(after.balance).toBe(after.ledger);
          // No more than it holds.
          expect((await issue(projectNumber, projectNumber, 100)).status).toBe(422);

          // A return goes back to the project's stock.
          const returned = await storeman('POST', `/inventory-transactions/${issued.body.transactionIds[0]}/returns`, { quantity: 1 });
          expect(returned.status).toBe(201);
          expect(Number((await ledgerAndBalance(looseId, locationId, projectNumber)).ledger)).toBe(Number(after.ledger) + 1);
        });

        it('moves and adjusts it between locations, keeping its project', async () => {
          await receivedForProject(looseId);
          const spare = await api<{ id: string }>('POST', '/locations', { name: `IT project shelf ${run}`, type: 'STOREROOM' });
          expect(spare.status).toBe(201);
          const stores = await ledgerAndBalance(looseId, locationId);

          const moved = await storeman<{ outTransactionId: string; inTransactionId: string }>('POST', '/inventory-transfers', {
            materialId: looseId, fromLocationId: locationId, toLocationId: spare.body.id, quantity: 2, heldForProject: projectNumber,
          });
          expect(moved.status).toBe(201);
          const legs = await prisma.inventoryTransaction.findMany({ where: { id: { in: [moved.body.outTransactionId, moved.body.inTransactionId] } } });
          expect(legs.map((l) => l.heldForProject)).toEqual([projectNumber, projectNumber]);
          expect((await ledgerAndBalance(looseId, spare.body.id, projectNumber)).balance).toBe('2');
          // The project's history finds its own stock moving, by filter and by search (Qodo, PR #145).
          const ofProject = (await api<Array<{ id: string; heldForProject: string | null }>>('GET', `/inventory-transactions?projectNumber=${projectNumber}&materialId=${looseId}`)).body;
          expect(ofProject.find((r) => r.id === moved.body.outTransactionId)?.heldForProject).toBe(projectNumber);
          const found = (await api<Array<{ id: string }>>('GET', `/inventory-transactions?q=${projectNumber}&materialId=${looseId}`)).body;
          expect(found.map((r) => r.id)).toContain(moved.body.outTransactionId);
          const reported = (await api<Array<{ id: string }>>('GET', `/reports/movement-history?projectNumber=${projectNumber}&materialId=${looseId}`)).body;
          expect(reported.map((r) => r.id)).toContain(moved.body.outTransactionId);

          const adjusted = await storeman('POST', '/inventory-adjustments', {
            materialId: looseId, locationId: spare.body.id, quantity: -0.5, reasonCode: 'DAMAGE', reasonNote: 'Bent in the rack', heldForProject: projectNumber,
          });
          expect(adjusted.status).toBe(201);
          expect((await ledgerAndBalance(looseId, spare.body.id, projectNumber)).balance).toBe('1.5');
          // Stores stock never moved, and a project that doesn't exist holds nothing.
          expect(await ledgerAndBalance(looseId, locationId)).toEqual(stores);
          expect((await storeman('POST', '/inventory-adjustments', {
            materialId: looseId, locationId: spare.body.id, quantity: 1, reasonCode: 'OTHER', heldForProject: `IT-NOPE-${run}`,
          })).status).toBe(404);
        });

        // Project Material Through the Store Roadmap, Phase 5: a closed project's
        // stock moves to Stores with its item.
        it('moves a closed project\'s held stock to Stores stock where it is, and makes the item a Stores item', async () => {
          const closing = `IT-SO-CLOSE-${run}`;
          expect((await api('POST', '/projects', { projectNumber: closing, name: `IT closing project ${run}` })).status).toBe(201);
          const rod = await api<{ id: string }>('POST', '/materials', { sku: `IT-SO-ROD-${run}`, name: `Integration rod ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'M' });
          expect(rod.status).toBe(200);
          const po = await buyer<{ id: string }>('POST', '/purchase-orders', { supplierId, projectNumber: closing, lines: [{ materialId: rod.body.id, orderedQty: 4, unitPrice: 40 }] });
          const submitted = await buyer<{ status: string }>('POST', `/purchase-orders/${po.body.id}/submit`);
          if (submitted.body.status === 'PENDING_APPROVAL') expect((await api('POST', `/purchase-orders/${po.body.id}/approve`)).status).toBe(200);
          expect((await storeman('POST', `/purchase-orders/${po.body.id}/receive`, { locationId })).status).toBe(200);
          expect((await ledgerAndBalance(rod.body.id, locationId, closing)).balance).toBe('4');

          // Not while the project is open; listed with its leftovers once it is closed.
          const move = () => api<{ moved: number }>('POST', `/projects/${closing}/leftovers/move`, { items: [{ materialId: rod.body.id, category: 'CONSUMABLES' }] });
          expect((await move()).status).toBe(400);
          expect((await api('PATCH', `/projects/${closing}`, { status: 'COMPLETED' })).status).toBe(200);
          const listed = (await api<{ items: Array<{ materialId: string; onHand: string; held: string }> }>('GET', `/projects/${closing}/leftovers`)).body.items;
          expect(listed.find((i) => i.materialId === rod.body.id)).toMatchObject({ onHand: '4', held: '4' });

          const moved = await move();
          expect(moved.status).toBe(200);
          expect(moved.body.moved).toBe(1);
          // Off the project, onto Stores stock, at the same location, as a linked pair.
          expect((await ledgerAndBalance(rod.body.id, locationId, closing)).balance).toBe('0');
          const stores = await ledgerAndBalance(rod.body.id, locationId);
          expect(stores.balance).toBe('4');
          expect(stores.ledger).toBe(stores.balance);
          const pair = await prisma.inventoryTransaction.findMany({ where: { materialId: rod.body.id, referenceType: 'MoveToStores', referenceId: closing }, orderBy: { type: 'asc' } });
          expect(pair.map((t) => [t.type, t.quantity.toString(), t.heldForProject])).toEqual([['TRANSFER_OUT', '-4', closing], ['TRANSFER_IN', '4', null]]);
          expect(pair[0]!.pairedWithId).toBe(pair[1]!.id);
          expect(await prisma.material.findUniqueOrThrow({ where: { id: rod.body.id } })).toMatchObject({ category: 'CONSUMABLES', projectNumber: null });
          expect((await api<{ items: unknown[] }>('GET', `/projects/${closing}/leftovers`)).body.items).toEqual([]);

          // Qodo, PR #149: the item changed with it, so the pair isn't reversed on its own.
          const reversal = await api<{ error: { message: string } }>('POST', `/inventory-transactions/${pair[0]!.id}/reversal`, { reason: 'Moved by mistake' });
          expect(reversal.status).toBe(409);
          expect(reversal.body.error.message).toMatch(/along with its item, so it isn.t reversed/);
          expect((await ledgerAndBalance(rod.body.id, locationId)).balance).toBe('4');
        });

        // Qodo, PR #149: an item tagged to another project but bought on this one's
        // order: this project's stock of it moves; the item stays the other's.
        it('moves a closed project\x27s stock of another project\x27s item, leaving the item that project\x27s', async () => {
          const owner = `IT-SO-OWNER-${run}`;
          const closing = `IT-SO-CLOSE2-${run}`;
          for (const p of [owner, closing]) expect((await api('POST', '/projects', { projectNumber: p, name: `IT ${p}` })).status).toBe(201);
          const bar = await api<{ id: string }>('POST', '/materials', { sku: `IT-SO-BAR-${run}`, name: `Integration bar ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'M' });
          expect(bar.status).toBe(200);
          // An old leftover item: tagged to the owner project.
          await prisma.material.update({ where: { id: bar.body.id }, data: { projectNumber: owner } });
          const po = await buyer<{ id: string }>('POST', '/purchase-orders', { supplierId, projectNumber: closing, lines: [{ materialId: bar.body.id, orderedQty: 3, unitPrice: 10 }] });
          const submitted = await buyer<{ status: string }>('POST', `/purchase-orders/${po.body.id}/submit`);
          if (submitted.body.status === 'PENDING_APPROVAL') expect((await api('POST', `/purchase-orders/${po.body.id}/approve`)).status).toBe(200);
          expect((await storeman('POST', `/purchase-orders/${po.body.id}/receive`, { locationId })).status).toBe(200);
          expect((await api('PATCH', `/projects/${closing}`, { status: 'COMPLETED' })).status).toBe(200);

          // Moved with no category: the item keeps what it is.
          const moved = await api('POST', `/projects/${closing}/leftovers/move`, { items: [{ materialId: bar.body.id }] });
          expect(moved.status).toBe(200);
          expect((await ledgerAndBalance(bar.body.id, locationId, closing)).balance).toBe('0');
          expect((await ledgerAndBalance(bar.body.id, locationId)).balance).toBe('3');
          expect(await prisma.material.findUniqueOrThrow({ where: { id: bar.body.id } })).toMatchObject({ category: 'PROJECT_MATERIAL', projectNumber: owner });
          // Now the owner project's leftover.
          const theirs = (await api<{ items: Array<{ materialId: string; onHand: string }> }>('GET', `/projects/${owner}/leftovers`)).body.items;
          expect(theirs.find((i) => i.materialId === bar.body.id)?.onHand).toBe('3');
        });
      });

      it("keeps a saved receipt for the store's order from a buyer: not listed, not found, not posted", async () => {
        const store = await approvedOrder(2);
        const saved = await storeman<{ id: string }>('POST', '/goods-receipts', {
          purchaseOrderId: store.id, supplierId,
          lines: [{ materialId, locationId, quantity: 1, purchaseOrderLineId: store.lines[0]!.id }],
        });
        expect(saved.status).toBe(201);
        expect((await buyer<Array<{ id: string }>>('GET', '/goods-receipts')).body.map((r) => r.id)).not.toContain(saved.body.id);
        expect((await buyer('GET', `/goods-receipts/${saved.body.id}`)).status).toBe(404);
        expect((await buyer('POST', `/goods-receipts/${saved.body.id}/post`)).status).toBe(404);
        // The store posts its own.
        expect((await storeman('POST', `/goods-receipts/${saved.body.id}/post`)).status).toBe(200);
      });

      it("keeps a buyer from receiving the store's order through a goods receipt", async () => {
        const store = await approvedOrder(2);
        const receipt = await buyer('POST', '/goods-receipts', {
          purchaseOrderId: store.id, supplierId, post: true,
          lines: [{ materialId, locationId, quantity: 1, purchaseOrderLineId: store.lines[0]!.id }],
        });
        expect(receipt.status).toBe(404);
      });
    });
  });
});
