// Real-HTTP + real-database tests for what is on order in stock status: an
// approved Stores order counts as still to come and lowers the re-order
// quantity; a draft doesn't; part of it received leaves the rest on order.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { ADMIN_EMAIL, client, letAdminSign, login, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface StatusRow {
  materialId: string; sku: string; status: string; onHand: string; onOrder: string; reorderQuantity: string;
  orders: Array<{ purchaseOrderId: string | null; number: string | null; outstanding: string; dueDate: string | null }>;
}
interface Order { id: string; number: string; status: string; lines: Array<{ id: string; materialId: string }> }

describe('stock on order over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let supplierId: string;
  let locationId: string;
  let token: string;

  const row = async () => {
    const res = await api<StatusRow[]>('GET', '/reports/stock-status');
    expect(res.status).toBe(200);
    return res.body.find((r) => r.materialId === materialId)!;
  };

  beforeAll(async () => {
    server = await startServer({ procurementEnabled: true });
    token = await login(server.port, ADMIN_EMAIL, requireAdminPassword());
    api = client(server.port, token);
    await letAdminSign(api);
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

  /** Raises a Stores order for `qty` and takes it to APPROVED. */
  async function approvedOrder(forMaterial: string, qty: number): Promise<Order> {
    const created = await api<Order>('POST', '/purchase-orders', { supplierId, lines: [{ materialId: forMaterial, orderedQty: qty, unitPrice: 5 }] });
    expect(created.status).toBe(201);
    const submitted = await api<Order>('POST', `/purchase-orders/${created.body.id}/submit`);
    if (submitted.body.status === 'PENDING_APPROVAL') expect((await api('POST', `/purchase-orders/${created.body.id}/approve`)).status).toBe(200);
    return created.body;
  }

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

  // Qodo, PR #134: the order routes answer someone who can't open Stores orders 404.
  it('keeps the quantity and due date, but not the order, from someone who cannot open Stores orders', async () => {
    const email = `it-oo-viewer-${run}@example.com`;
    const password = `viewer-${run}-pass`;
    expect((await api('POST', '/users', { email, name: `IT on-order viewer ${run}`, password, roleNames: ['VIEWER'] })).status).toBe(201);
    const viewer = client(server.port, await login(server.port, email, password));
    const res = await viewer<StatusRow[]>('GET', '/reports/stock-status');
    expect(res.status).toBe(200);
    expect(res.body.find((r) => r.materialId === materialId)).toMatchObject({
      onOrder: '18', reorderQuantity: '70', orders: [{ purchaseOrderId: null, number: null, outstanding: '18', dueDate: '2026-12-01' }],
    });
  });

  // Qodo, PR #134: what is all on order isn't on the list of what to order.
  it('leaves an item whose shortfall is all on order out of the re-order list download', async () => {
    const covered = await api<{ id: string }>('POST', '/materials', { sku: `IT-OO-COV-${run}`, name: `Covered disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: 10, unitCost: 5 });
    await approvedOrder(covered.body.id, 10);
    const status = (await api<StatusRow[]>('GET', '/reports/stock-status?status=URGENT')).body;
    expect(status.find((r) => r.materialId === covered.body.id)).toMatchObject({ status: 'URGENT', onOrder: '10', reorderQuantity: '0' });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/reports/reorder-list/export`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const codes: unknown[] = [];
    wb.getWorksheet('Re-order list')!.eachRow((r) => codes.push((r.values as unknown[])[1]));
    expect(codes).toContain(`IT-OO-${run}`);
    expect(codes).not.toContain(`IT-OO-COV-${run}`);
  });

  // Qodo, PR #134: with procurement off, those orders can't be received or cancelled.
  it("doesn't count orders with procurement off", async () => {
    const off = await startServer({ procurementEnabled: false });
    try {
      const offApi = client(off.port, await login(off.port, ADMIN_EMAIL, requireAdminPassword()));
      const res = await offApi<StatusRow[]>('GET', '/reports/stock-status');
      expect(res.body.find((r) => r.materialId === materialId)).toMatchObject({ onHand: '12', onOrder: '0', orders: [], reorderQuantity: '88' });
    } finally {
      await off.close();
    }
  });
});
