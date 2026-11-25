// Every path that can take stock out, raced against itself or an issue, with
// the requests held so they truly overlap (`overlapping`, ADR-047). Between
// them the two would take more than there is: exactly one may succeed, the
// other is refused (INSUFFICIENT_BALANCE, or CONFLICT for a count whose stock
// moved while it was open), and the ledger and the stored balance agree on
// what is left, never below zero (BR-009).
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ADMIN_EMAIL, client, ledgerAndBalance, letAdminSign, login, overlapping, prisma, requireAdminPassword, runId, secondAdmin, startServer,
  type ApiResponse, type TestServer,
} from './helpers.js';

type Body = { error?: { code: string; message: string } };

describe('racing stock out of one balance (BR-009, ADR-047)', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let checker: ReturnType<typeof client>;
  let recipientId: string;
  let supplierId: string;
  let n = 0;

  /** A new item, with unit cost so its adjustments can be reversed. */
  async function item(category = 'CONSUMABLES'): Promise<string> {
    n += 1;
    const res = await api<{ id: string }>('POST', '/materials', {
      sku: `RACE${n}-${run}`, name: `Race item ${n} ${run}`, category, unitOfMeasure: 'each', unitCost: 1, requiredStock: 0,
    });
    expect(res.status).toBe(200);
    return res.body.id;
  }
  async function shelf(): Promise<string> {
    n += 1;
    return (await api<{ id: string }>('POST', '/locations', { name: `Race shelf ${n} ${run}`, type: 'STOREROOM' })).body.id;
  }
  async function found(materialId: string, locationId: string, quantity: number) {
    const res = await api<{ transactionId: string }>('POST', '/inventory-adjustments', {
      materialId, locationId, quantity, reasonCode: 'FOUND', reasonNote: 'Race test opening balance',
    });
    expect(res.status).toBe(201);
    return res.body.transactionId;
  }
  const issue = (materialId: string, locationId: string, quantity: number) => () =>
    api<Body>('POST', '/inventory-issues', { recipientId, lines: [{ materialId, locationId, quantity }] });

  /** One of the two got through, the other was refused for want of stock. */
  function expectOneRefused(responses: Array<ApiResponse<Body>>) {
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 422]);
    expect(responses.find((r) => r.status === 422)!.body.error!.code).toBe('INSUFFICIENT_BALANCE');
  }

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    await letAdminSign(api);
    checker = await secondAdmin(server.port, api, run);
    recipientId = (await api<{ id: string }>('POST', '/recipients', { name: `Race fitter ${run}`, type: 'WORKER' })).body.id;
    supplierId = (await api<{ id: string }>('POST', '/suppliers', { name: `Race supplier ${run}` })).body.id;
  });

  afterAll(async () => { await server?.close(); });

  it('two issues of 6 from 10', async () => {
    const m = await item(); const s = await shelf();
    await found(m, s, 10);
    expectOneRefused(await overlapping([issue(m, s, 6), issue(m, s, 6)]));
    expect(await ledgerAndBalance(m, s)).toEqual({ ledger: '4', balance: '4' });
  });

  it('two transfers of 6 from 10', async () => {
    const m = await item(); const from = await shelf(); const to = await shelf();
    await found(m, from, 10);
    const transfer = () => api<Body>('POST', '/inventory-transfers', { materialId: m, fromLocationId: from, toLocationId: to, quantity: 6 });
    expectOneRefused(await overlapping([transfer, transfer]));
    expect(await ledgerAndBalance(m, from)).toEqual({ ledger: '4', balance: '4' });
    expect(await ledgerAndBalance(m, to)).toEqual({ ledger: '6', balance: '6' });
  });

  // Each transfer names its own source first, so between them the two shelves
  // arrive in opposite orders. Taken as given, each would hold one balance lock
  // and wait for the other's: a deadlock, and PostgreSQL would refuse one with
  // 409 CONFLICT. lockInventoryBalances sorts the keys, so the second waits
  // holding nothing, and both go through.
  it('two transfers of 6 in opposite directions, each shelf holding 10', async () => {
    const m = await item(); const a = await shelf(); const b = await shelf();
    await found(m, a, 10);
    await found(m, b, 10);
    const transfer = (from: string, to: string) => () =>
      api<Body>('POST', '/inventory-transfers', { materialId: m, fromLocationId: from, toLocationId: to, quantity: 6 });
    const responses = await overlapping([transfer(a, b), transfer(b, a)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await ledgerAndBalance(m, a)).toEqual({ ledger: '10', balance: '10' });
    expect(await ledgerAndBalance(m, b)).toEqual({ ledger: '10', balance: '10' });
  });

  it('two write-offs of 6 from 10', async () => {
    const m = await item(); const s = await shelf();
    await found(m, s, 10);
    const damage = () => api<Body>('POST', '/inventory-adjustments', {
      materialId: m, locationId: s, quantity: -6, reasonCode: 'DAMAGE', reasonNote: 'Race test damage',
    });
    expectOneRefused(await overlapping([damage, damage]));
    expect(await ledgerAndBalance(m, s)).toEqual({ ledger: '4', balance: '4' });
  });

  it('reversing a receipt of 10 while 6 are issued', async () => {
    const m = await item(); const s = await shelf();
    const receipt = await found(m, s, 10);
    const reverse = () => api<Body>('POST', `/inventory-transactions/${receipt}/reversal`, { reason: 'Race test: booked twice' });
    const responses = await overlapping([reverse, issue(m, s, 6)]);
    expectOneRefused(responses);
    const { ledger, balance } = await ledgerAndBalance(m, s);
    expect(ledger).toBe(balance);
    // Reversal first leaves 0 and refuses the issue; issue first leaves 4 and refuses the reversal.
    expect(balance).toBe(responses[0]!.status === 201 ? '0' : '4');
  });

  it('a count that finds none while 6 are issued', async () => {
    const m = await item(); const s = await shelf();
    await found(m, s, 10);
    const count = () => api<Body & { heldBack?: unknown[] }>('POST', '/stock-counts', {
      locationId: s, lines: [{ materialId: m, expectedQuantity: 10, countedQuantity: 0 }],
    });
    const [counted, issued] = await overlapping([count, issue(m, s, 6)]);
    const { ledger, balance } = await ledgerAndBalance(m, s);
    expect(ledger).toBe(balance);
    if (issued!.status === 201) {
      // The issue went first: the count saw stock move under it, adjusted
      // nothing, and asks for a recount (409, not 422: nothing was short).
      expect(balance).toBe('4');
      expect([counted!.status, counted!.body.error!.code]).toEqual([409, 'CONFLICT']);
    } else {
      // The count went first and wrote 10 off: nothing was left to issue.
      expect([counted!.status, issued!.status, issued!.body.error!.code]).toEqual([201, 422, 'INSUFFICIENT_BALANCE']);
      expect(balance).toBe('0');
    }
  });

  it('two tool check-outs of the last drill', async () => {
    const drill = await item('TOOLS'); const s = await shelf();
    await found(drill, s, 1);
    const lend = () => api<Body>('POST', '/tools/check-out', { recipientId, lines: [{ materialId: drill, locationId: s, quantity: 1 }] });
    expectOneRefused(await overlapping([lend, lend]));
    expect(await ledgerAndBalance(drill, s)).toEqual({ ledger: '0', balance: '0' });
  });

  it('two returns to the supplier of 4 when 5 are left of 10 received', async () => {
    const m = await item(); const s = await shelf();
    const order = await api<{ id: string; lines: Array<{ id: string }> }>('POST', '/purchase-orders', { supplierId, lines: [{ materialId: m, orderedQty: 10, unitPrice: 1 }] });
    expect(order.status).toBe(201);
    const submitted = await api<{ status: string }>('POST', `/purchase-orders/${order.body.id}/submit`);
    if (submitted.body.status === 'PENDING_APPROVAL') expect((await checker('POST', `/purchase-orders/${order.body.id}/approve`)).status).toBe(200);
    const gr = await api<{ id: string }>('POST', '/goods-receipts', {
      purchaseOrderId: order.body.id, supplierId, deliveryRef: `DN-RACE-${run}`, post: true,
      lines: [{ materialId: m, locationId: s, quantity: 10, purchaseOrderLineId: order.body.lines[0]!.id }],
    });
    expect(gr.status).toBe(201);
    expect((await issue(m, s, 5)()).status).toBe(201);
    const line = await prisma.goodsReceiptLine.findFirstOrThrow({ where: { goodsReceiptId: gr.body.id } });
    // 8 back is within the 10 received, so only the stock on the shelf decides.
    const sendBack = () => api<Body>('POST', `/goods-receipts/${gr.body.id}/lines/${line.id}/return`, { quantity: 4, reason: 'Race test: wrong rating' });
    expectOneRefused(await overlapping([sendBack, sendBack]));
    expect(await ledgerAndBalance(m, s)).toEqual({ ledger: '1', balance: '1' });
  });
});
