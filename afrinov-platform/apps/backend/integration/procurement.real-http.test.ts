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
      expect(order.totals).toEqual({ subtotal: '10.00', vat: '0.00', net: '10.00', unpricedLines: 0 });
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
    it('lets an approver with a limit open and approve orders within it, and refuses one over it', async () => {
      const email = `it-approver-${run}@afrinov.local`;
      const password = `It-${run}-approver`;
      const created = await api<{ id: string }>('POST', '/users', { email, name: `IT Approver ${run}`, password, roleNames: ['APPROVER'] });
      expect(created.status).toBe(201);
      expect((await api('PATCH', `/users/${created.body.id}`, { approvalLimit: 1000 })).status).toBe(200);
      const approver = client(server.port, await login(server.port, email, password));

      const order = async (price: number) => {
        const res = await api<{ id: string }>('POST', '/purchase-orders', { supplierId, vatRate: 15, lines: [{ materialId, orderedQty: 1, unitPrice: price }] });
        await api('POST', `/purchase-orders/${res.body.id}/submit`);
        return res.body.id;
      };
      const small = await order(800); // R920 with VAT
      const large = await order(900); // R1 035 with VAT
      // With approval switched off in Settings, submitting approves: nothing to check here.
      if ((await api<{ status: string }>('GET', `/purchase-orders/${small}`)).body.status !== 'PENDING_APPROVAL') return;

      expect((await approver('GET', `/purchase-orders/${small}`)).status).toBe(200);
      const view = await approver<{ canApprove: boolean; net: string }>('GET', `/purchase-orders/${large}/approval`);
      expect(view.body).toMatchObject({ canApprove: false, net: '1035.00' });
      const waiting = await approver<Array<{ id: string }>>('GET', '/purchase-orders?awaitingMyApproval=true');
      expect(waiting.status).toBe(200);
      expect(waiting.body.map((p) => p.id)).toContain(small);
      expect(waiting.body.map((p) => p.id)).not.toContain(large);

      const refused = await approver<{ error: { code: string; message: string } }>('POST', `/purchase-orders/${large}/approve`);
      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toMatch(/approval limit/);
      expect((await approver('POST', `/purchase-orders/${small}/approve`)).status).toBe(200);
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
      if (submitted.body.status === 'PENDING_APPROVAL') await api('POST', `/purchase-orders/${created.body.id}/approve`);
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
    // path now locks the number first. Twelve of each, as fewer rarely overlap.
    it('posts receipts against orders and stock receipts for one item at once, none failing', async () => {
      const each = 12;
      const orders = await Promise.all(Array.from({ length: each }, () => approvedOrder(1)));
      const { ledger: before } = await ledgerAndBalance(materialId, locationId);

      const results = await Promise.all([
        ...orders.map((order) => api('POST', '/goods-receipts', {
          purchaseOrderId: order.id, supplierId,
          lines: [{ materialId, locationId, quantity: 1, purchaseOrderLineId: order.lines[0]!.id }],
          post: true,
        })),
        ...Array.from({ length: each }, (_, i) => api('POST', '/stock-receipts', {
          supplierId, deliveryRef: `INV-MIX-${run}-${i}`,
          lines: [{ materialId, locationId, quantity: 1 }],
        })),
      ]);

      expect(results.map((r) => r.status)).toEqual(Array(each * 2).fill(201));
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

    async function as(role: string) {
      const email = `it-so-${role.toLowerCase()}-${run}@afrinov.local`;
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
      const theirs = await buyer<{ id: string }>('POST', '/purchase-orders', projectOrder());
      for (const [method, path, body] of [
        ['PATCH', `/purchase-orders/${theirs.body.id}`, { notes: 'Not mine' }],
        ['POST', `/purchase-orders/${theirs.body.id}/submit`, undefined],
        ['POST', `/purchase-orders/${theirs.body.id}/cancel`, { reason: 'Not mine' }],
        ['POST', `/purchase-orders/${theirs.body.id}/close`, {}],
      ] as const) {
        expect([method, path, (await storeman(method, path, body)).status]).toEqual([method, path, 403]);
      }
      // Both can still open each other's orders.
      expect((await storeman('GET', `/purchase-orders/${theirs.body.id}`)).status).toBe(200);
      expect((await buyer('GET', `/purchase-orders/${created.body.id}`)).status).toBe(200);
    });

    it('lets a buyer raise a project order, and no Stores order', async () => {
      expect((await buyer('POST', '/purchase-orders', projectOrder())).status).toBe(201);
      expect((await buyer('POST', '/purchase-orders', storesOrder())).status).toBe(403);
      const theirs = await storeman<{ id: string }>('POST', '/purchase-orders', storesOrder());
      expect((await buyer('PATCH', `/purchase-orders/${theirs.body.id}`, { notes: 'Not mine' })).status).toBe(403);
      expect((await buyer('POST', `/purchase-orders/${theirs.body.id}/submit`)).status).toBe(403);
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
  });
});
