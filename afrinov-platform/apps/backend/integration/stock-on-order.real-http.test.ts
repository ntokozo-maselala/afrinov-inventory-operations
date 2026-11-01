// Real-HTTP + real-database tests for what is on order in stock status: an
// approved Stores order counts as still to come and lowers the re-order
// quantity; a draft doesn't; part of it received leaves the rest on order.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface StatusRow {
  materialId: string; status: string; onHand: string; onOrder: string; reorderQuantity: string;
  orders: Array<{ purchaseOrderId: string; number: string; outstanding: string; dueDate: string | null }>;
}
interface Order { id: string; number: string; status: string; lines: Array<{ id: string; materialId: string }> }

describe('stock on order over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let supplierId: string;
  let locationId: string;

  const row = async () => {
    const res = await api<StatusRow[]>('GET', '/reports/stock-status');
    expect(res.status).toBe(200);
    return res.body.find((r) => r.materialId === materialId)!;
  };

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const m = await api<{ id: string }>('POST', '/materials', { sku: `IT-OO-${run}`, name: `On order disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: 100 });
    expect(m.status).toBe(200);
    materialId = m.body.id;
    const sup = await api<{ id: string }>('POST', '/suppliers', { name: `IT On-order Supplier ${run}` });
    supplierId = sup.body.id;
    const loc = await api<{ id: string }>('POST', '/locations', { name: `IT on-order rack ${run}`, type: 'RACK' });
    locationId = loc.body.id;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('counts an approved Stores order as on order, and not a draft', async () => {
    expect(await row()).toMatchObject({ status: 'URGENT', onHand: '0', onOrder: '0', reorderQuantity: '100', orders: [] });

    const draft = await api<Order>('POST', '/purchase-orders', { supplierId, lines: [{ materialId, orderedQty: 50 }] });
    expect(draft.status).toBe(201);
    expect((await row()).onOrder).toBe('0');

    const created = await api<Order>('POST', '/purchase-orders', {
      supplierId, expectedDeliveryDate: '2026-12-01', lines: [{ materialId, orderedQty: 30, unitPrice: 12.5 }],
    });
    expect(created.status).toBe(201);
    const submitted = await api<Order>('POST', `/purchase-orders/${created.body.id}/submit`);
    expect(submitted.status).toBe(200);
    if (submitted.body.status === 'PENDING_APPROVAL') {
      expect((await row()).onOrder).toBe('0');
      const approved = await api('POST', `/purchase-orders/${created.body.id}/approve`);
      expect(approved.status).toBe(200);
    }

    // Still URGENT (nothing is on the shelf), but only 70 left to order.
    expect(await row()).toMatchObject({
      status: 'URGENT', onOrder: '30', reorderQuantity: '70',
      orders: [{ purchaseOrderId: created.body.id, number: created.body.number, outstanding: '30', dueDate: '2026-12-01' }],
    });

    // Part of it received: on hand up, the rest still on order.
    const order = (await api<Order>('GET', `/purchase-orders/${created.body.id}`)).body;
    const receipt = await api<{ id: string }>('POST', '/goods-receipts', {
      purchaseOrderId: order.id, supplierId, deliveryRef: `DN-OO-${run}`, post: true,
      lines: [{ materialId, locationId, quantity: 12, purchaseOrderLineId: order.lines[0]!.id }],
    });
    expect(receipt.status).toBe(201);
    expect(await row()).toMatchObject({ onHand: '12', onOrder: '18', reorderQuantity: '70', orders: [{ outstanding: '18' }] });
  });
});
