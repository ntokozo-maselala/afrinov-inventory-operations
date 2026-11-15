// Real-HTTP + real-database tests for stock accuracy and corrections (system
// audit P4, ADR-040): tool and leftover moves retry-safe (B3), a damaged tool
// held for repair (B2), counts that are blind, full or spot, of a project's
// stock, and that hold back only what moved (C4-C7), deliveries over the order
// (A8), and a receipt line reversed (A7) or sent back to the supplier (A6).
// The import's whole-unit check (H6) is in opening-balances.real-http.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, letAdminSign, login, prisma, requireAdminPassword, runId, secondAdmin, startServer, type TestServer } from './helpers.js';

type Failure = { error: { code: string; message: string } };

describe('P4 stock accuracy over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let checker: ReturnType<typeof client>;
  let supplierId: string;
  let workerId: string;

  const rack = async (name: string) => (await api<{ id: string }>('POST', '/locations', { name: `${name} ${run}`, type: 'RACK' })).body.id;
  const item = async (sku: string, category = 'CONSUMABLES', unitCost = 10) => {
    const res = await api<{ id: string }>('POST', '/materials', { sku: `${sku}-${run}`, name: `${sku} ${run}`, category, unitOfMeasure: 'each', unitCost });
    expect(res.status).toBe(200);
    return res.body.id;
  };
  const found = async (materialId: string, locationId: string, quantity: number) =>
    expect((await api('POST', '/inventory-adjustments', { materialId, locationId, quantity, reasonCode: 'FOUND', reasonNote: 'P4 test stock' })).status).toBe(201);
  const setting = (key: string, value: unknown) => prisma.setting.update({ where: { key }, data: { value: value as never } });

  /** An approved Stores order for `qty` of the item. */
  async function approvedOrder(materialId: string, qty: number) {
    const created = await api<{ id: string; lines: Array<{ id: string }> }>('POST', '/purchase-orders', { supplierId, lines: [{ materialId, orderedQty: qty, unitPrice: 10 }] });
    expect(created.status).toBe(201);
    const submitted = await api<{ status: string }>('POST', `/purchase-orders/${created.body.id}/submit`);
    if (submitted.body.status === 'PENDING_APPROVAL') expect((await checker('POST', `/purchase-orders/${created.body.id}/approve`)).status).toBe(200);
    return created.body;
  }
  const receive = (order: { id: string; lines: Array<{ id: string }> }, materialId: string, locationId: string, quantity: number, overDeliveryReason?: string) =>
    api<{ id: string; status: string; lines: Array<{ id: string }> } & Failure>('POST', '/goods-receipts', {
      purchaseOrderId: order.id, supplierId, deliveryRef: `DN-${order.id.slice(0, 6)}-${quantity}`, post: true,
      lines: [{ materialId, locationId, quantity, purchaseOrderLineId: order.lines[0]!.id, ...(overDeliveryReason ? { overDeliveryReason } : {}) }],
    });
  const orderOf = async (id: string) => prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    await letAdminSign(api);
    checker = await secondAdmin(server.port, api, run);
    supplierId = (await api<{ id: string }>('POST', '/suppliers', { name: `IT P4 supplier ${run}` })).body.id;
    workerId = (await api<{ id: string }>('POST', '/recipients', { name: `IT P4 fitter ${run}`, type: 'WORKER' })).body.id;
  });

  afterAll(async () => {
    // Shared by every suite: put the settings this one changes back.
    await setting('inventory.blindCounts', false);
    await setting('purchaseOrders.overDeliveryPercent', 0);
    await setting('inventory.requireWriteOffApproval', false);
    await server?.close();
  });

  it('replays a retried tool check-out and check-in instead of posting them twice (B3)', async () => {
    const drill = await item('IT-P4-DRILL', 'TOOLS');
    const r = await rack('IT P4 tools');
    await found(drill, r, 2);
    const key = { 'idempotency-key': `p4-out-${run}` };
    const body = { recipientId: workerId, lines: [{ materialId: drill, locationId: r, quantity: 1 }] };
    const first = await api<{ loanIds: string[] }>('POST', '/tools/check-out', body, key);
    const again = await api<{ loanIds: string[] }>('POST', '/tools/check-out', body, key);
    expect(first.status).toBe(201);
    expect(again.body.loanIds).toEqual(first.body.loanIds);
    expect((await ledgerAndBalance(drill, r)).balance).toBe('1');
    const back = { lines: [{ loanId: first.body.loanIds[0], quantity: 1, condition: 'GOOD' }] };
    const inKey = { 'idempotency-key': `p4-in-${run}` };
    expect((await api('POST', '/tools/check-in', back, inKey)).status).toBe(201);
    expect((await api('POST', '/tools/check-in', back, inKey)).status).toBe(201);
    expect((await ledgerAndBalance(drill, r)).balance).toBe('2');
  });

  it('holds a damaged tool for repair, moves the hold with it, and frees it once repaired or written off (B2)', async () => {
    const grinder = await item('IT-P4-GRINDER', 'TOOLS', 500);
    const [shelf, bench] = [await rack('IT P4 shelf'), await rack('IT P4 bench')];
    await found(grinder, shelf, 2);
    const out = await api<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId: workerId, lines: [{ materialId: grinder, locationId: shelf, quantity: 2 }] });
    await api('POST', '/tools/check-in', { lines: [{ loanId: out.body.loanIds[0], quantity: 2, condition: 'DAMAGED', note: 'Guard cracked' }] });
    const tool = async () => (await api<Array<{ materialId: string; heldForRepair: string; repairs: Array<{ id: string; locationId: string; writeOffWaiting: boolean }> }>>('GET', '/tools')).body.find((t) => t.materialId === grinder)!;
    expect((await tool()).heldForRepair).toBe('2');
    const refused = await api<Failure>('POST', '/tools/check-out', { recipientId: workerId, lines: [{ materialId: grinder, locationId: shelf, quantity: 1 }] });
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toMatch(/held for repair/);

    // One goes to the repair bench: its hold goes with it.
    expect((await api('POST', '/inventory-transfers', { materialId: grinder, fromLocationId: shelf, toLocationId: bench, quantity: 1 })).status).toBe(201);
    const split = await tool();
    expect(split.repairs.map((x) => x.locationId).sort()).toEqual([shelf, bench].sort());
    const onBench = split.repairs.find((x) => x.locationId === bench)!;
    const onShelf = split.repairs.find((x) => x.locationId === shelf)!;
    expect((await api('POST', `/tools/repairs/${onBench.id}/repaired`, { note: 'New guard fitted' })).status).toBe(200);
    expect((await api('POST', `/tools/repairs/${onBench.id}/repaired`, {})).status).toBe(409);
    expect((await api('POST', '/tools/check-out', { recipientId: workerId, lines: [{ materialId: grinder, locationId: bench, quantity: 1 }] })).status).toBe(201);

    // Written off over the limit (R 500 > R 0): it waits for someone else, still held, then goes.
    await setting('inventory.requireWriteOffApproval', true);
    await setting('inventory.writeOffApprovalAbove', 0);
    try {
    const writeOff = await api<{ status: string; requestId: string }>('POST', `/tools/repairs/${onShelf.id}/write-off`, { note: 'Motor burnt out' });
    expect(writeOff.status).toBe(202);
    expect((await tool()).repairs.find((x) => x.id === onShelf.id)?.writeOffWaiting).toBe(true);
    expect((await api('POST', `/tools/repairs/${onShelf.id}/repaired`, {})).status).toBe(409);
    expect((await checker('POST', `/adjustment-requests/${writeOff.body.requestId}/approve`)).status).toBe(201);
    expect((await prisma.toolRepair.findUniqueOrThrow({ where: { id: onShelf.id } })).resolution).toBe('WRITTEN_OFF');
    expect((await ledgerAndBalance(grinder, shelf)).balance).toBe('0');
    } finally {
      await setting('inventory.requireWriteOffApproval', false);
      await setting('inventory.writeOffApprovalAbove', 1000);
    }
  });

  it('counts a project\'s stock, fully, blind, and holds back only the line that moved (C4-C7)', async () => {
    const job = `IT-P4-${run}`;
    expect((await api('POST', '/projects', { projectNumber: job, name: `P4 job ${run}`, status: 'ACTIVE' })).status).toBe(201);
    const [bolt, nut] = [await item('IT-P4-BOLT'), await item('IT-P4-NUT')];
    const r = await rack('IT P4 count rack');
    await found(bolt, r, 10);
    await found(nut, r, 6);
    await api('POST', '/inventory-adjustments', { materialId: bolt, locationId: r, quantity: 4, reasonCode: 'FOUND', reasonNote: 'Held for the job', heldForProject: job });

    type Sheet = { openedAt: string; blind: boolean; projects: string[]; lines: Array<{ materialId: string; expected: string | null }> };
    const stores = (await api<Sheet>('GET', `/stock-counts/sheet?locationId=${r}`)).body;
    expect(stores.projects).toEqual([job]);
    expect(stores.lines.map((l) => [l.materialId, l.expected]).sort()).toEqual([[bolt, '10'], [nut, '6']].sort());

    // A full count leaves nothing out.
    const missing = await api<Failure>('POST', '/stock-counts', { locationId: r, kind: 'FULL', openedAt: stores.openedAt, lines: [{ materialId: bolt, expectedQuantity: 10, countedQuantity: 10 }] });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/A full count lists every item/);

    // The project's stock has its own sheet and its own adjustment.
    const projectCount = await api<{ kind: string; heldForProject: string; adjusted: number }>('POST', '/stock-counts', {
      locationId: r, heldForProject: job, kind: 'FULL', lines: [{ materialId: bolt, expectedQuantity: 4, countedQuantity: 3 }],
    });
    expect(projectCount.body).toMatchObject({ kind: 'FULL', heldForProject: job, adjusted: 1 });
    expect((await ledgerAndBalance(bolt, r, job)).balance).toBe('3');
    expect((await ledgerAndBalance(bolt, r)).balance).toBe('10');

    // Blind: no figures; a movement after the sheet opened holds its line back, the rest posts.
    await setting('inventory.blindCounts', true);
    const blind = (await api<Sheet>('GET', `/stock-counts/sheet?locationId=${r}`)).body;
    expect(blind.blind).toBe(true);
    expect(blind.lines.every((l) => l.expected === null)).toBe(true);
    await found(nut, r, 1);
    const posted = await api<{ counted: number; heldBack: Array<{ materialId: string; expected?: string }> }>('POST', '/stock-counts', {
      locationId: r, kind: 'FULL', openedAt: blind.openedAt, lines: [{ materialId: bolt, countedQuantity: 9 }, { materialId: nut, countedQuantity: 6 }],
    });
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({ counted: 1, heldBack: [{ materialId: nut }] });
    expect(posted.body.heldBack[0]).not.toHaveProperty('expected');
    expect((await ledgerAndBalance(bolt, r)).balance).toBe('9');
    expect((await ledgerAndBalance(nut, r)).balance).toBe('7');
    await setting('inventory.blindCounts', false);
  });

  it('receives a delivery over the order only within the allowance and with a reason (A8)', async () => {
    const cable = await item('IT-P4-CABLE');
    const r = await rack('IT P4 receiving');
    const order = await approvedOrder(cable, 100);
    expect((await receive(order, cable, r, 105)).status).toBe(400);
    await setting('purchaseOrders.overDeliveryPercent', 5);
    expect((await receive(order, cable, r, 106, 'Sold by the drum')).status).toBe(400);
    const noReason = await receive(order, cable, r, 105);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.message).toMatch(/say why the extra is kept/);
    expect((await receive(order, cable, r, 105, 'Sold by the drum')).status).toBe(201);
    const after = await orderOf(order.id);
    expect([after.status, after.lines[0]!.receivedQty.toString()]).toEqual(['RECEIVED', '105']);
    expect((await prisma.goodsReceiptLine.findFirstOrThrow({ where: { purchaseOrderLineId: order.lines[0]!.id } })).overDeliveryReason).toBe('Sold by the drum');
    await setting('purchaseOrders.overDeliveryPercent', 0);
  });

  it('sends goods back to the supplier, owed again, and reverses a wrong receipt line with its order (A6, A7)', async () => {
    const valve = await item('IT-P4-VALVE');
    const r = await rack('IT P4 valves');
    const order = await approvedOrder(valve, 10);
    const gr = await receive(order, valve, r, 10);
    expect(gr.status).toBe(201);
    const line = (await prisma.goodsReceiptLine.findFirstOrThrow({ where: { goodsReceiptId: gr.body.id } }));
    expect(line.transactionId).toBeTruthy();
    expect((await orderOf(order.id)).status).toBe('RECEIVED');

    // Three go back: off the stock, owed again on the order.
    const back = await api<{ transactionId: string; orderStatus: string }>('POST', `/goods-receipts/${gr.body.id}/lines/${line.id}/return`, { quantity: 3, reason: 'Wrong pressure rating', supplierReference: 'CN-88' });
    expect(back.status).toBe(201);
    expect(back.body.orderStatus).toBe('PARTIALLY_RECEIVED');
    expect((await orderOf(order.id)).lines[0]!.receivedQty.toString()).toBe('7');
    expect((await ledgerAndBalance(valve, r)).balance).toBe('7');
    expect((await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: back.body.transactionId } })).type).toBe('RETURN_TO_SUPPLIER');
    expect((await api('POST', `/goods-receipts/${gr.body.id}/lines/${line.id}/return`, { quantity: 8, reason: 'Too many' })).status).toBe(400);
    // Partly sent back, the line isn't reversed.
    expect((await api<Failure>('POST', `/inventory-transactions/${line.transactionId}/reversal`, { reason: 'Booked twice' })).status).toBe(409);

    // A line booked against the wrong order is reversed, and the order owes it all again.
    const other = await approvedOrder(valve, 4);
    const wrong = await receive(other, valve, r, 4);
    const wrongLine = await prisma.goodsReceiptLine.findFirstOrThrow({ where: { goodsReceiptId: wrong.body.id } });
    expect((await api('POST', `/inventory-transactions/${wrongLine.transactionId}/reversal`, { reason: 'Booked against the wrong order' })).status).toBe(201);
    const reopened = await orderOf(other.id);
    expect([reopened.status, reopened.lines[0]!.receivedQty.toString(), reopened.deliveredAt]).toEqual(['APPROVED', '0', null]);
    expect((await ledgerAndBalance(valve, r)).balance).toBe('7');
  });
});
