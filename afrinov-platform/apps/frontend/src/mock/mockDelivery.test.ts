// The mock receives a project order into stock held for its project, and no
// longer confirms one, as the server does (Project Material Through the Store
// Roadmap, Phase 2).
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Counter receipts, as with procurement off; receiving against orders needs no switch in the mock.
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: false }));
import { createMockApi, resetMockState, mockOrderRaisedBy } from './mockApi';

const api = createMockApi();
beforeEach(() => resetMockState());

interface Order { id: string; status: string; lines: Array<{ id: string; receivedQty: string }> }
const messageOf = (p: Promise<unknown>) => p.then(() => undefined, (e: { message?: string }) => e.message);

/** An approved project order for 4 of AFRI-1325's plate. */
async function approvedProjectOrder(): Promise<Order> {
  await api.patch('/materials/mat-9', { projectNumber: 'AFRI-1325' });
  const po = await api.post<Order>('/purchase-orders', { supplierId: 'sup-1', projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', orderedQty: 4, unitPrice: 10 }] });
  const submitted = await api.post<Order>(`/purchase-orders/${po.id}/submit`, {});
  mockOrderRaisedBy(po.id, 'user-2'); // raised by someone else: nobody approves their own
  if (submitted.status === 'PENDING_APPROVAL') await api.post(`/purchase-orders/${po.id}/approve`, {});
  return api.get<Order>(`/purchase-orders/${po.id}`);
}

/** Receives what an order still owes on one posted goods receipt, as the store does on Receive stock (system audit D3). */
async function receiveRest(id: string): Promise<void> {
  const po = await api.get<{ supplierId: string; lines: Array<{ id: string; materialId: string; orderedQty: string; receivedQty: string }> }>(`/purchase-orders/${id}`);
  const lines = po.lines.filter((l) => Number(l.orderedQty) > Number(l.receivedQty))
    .map((l) => ({ materialId: l.materialId, locationId: 'loc-1', quantity: Number(l.orderedQty) - Number(l.receivedQty), purchaseOrderLineId: l.id }));
  await api.post('/goods-receipts', { supplierId: po.supplierId, purchaseOrderId: id, post: true, lines });
}

describe('mock: the delivery date of a receipt', () => {
  const receipt = (receivedAt: string) => ({ supplierId: 'sup-1', deliveryRef: 'INV-1', receivedAt, lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] });
  const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

  // Qodo, PR #123: as the server checks it.
  it('refuses a day still to come, or a date that is not one, by either way in', async () => {
    for (const path of ['/goods-receipts', '/stock-receipts']) {
      expect(await messageOf(api.post(path, receipt(tomorrow)))).toMatch(/cannot be in the future/);
      expect(await messageOf(api.post(path, receipt('2026-02-31')))).toMatch(/Invalid delivery date/);
    }
  });

  it('keeps an earlier day', async () => {
    const saved = await api.post<{ number: string }>('/stock-receipts', receipt('2026-10-01'));
    const rows = await api.get<Array<{ number: string; receivedAt: string }>>('/stock-receipts');
    expect(rows.find((r) => r.number === saved.number)?.receivedAt.slice(0, 10)).toBe('2026-10-01');
  });
});

describe('mock: delivery of a project order', () => {
  type StockRow = { materialId: string; locationId: string; quantity: string; heldForProject?: string | null };
  const heldFor = async (projectNumber: string) => (await api.get<StockRow[]>('/reports/current-stock?materialId=mat-9'))
    .filter((r) => r.heldForProject === projectNumber).reduce((a, r) => a + Number(r.quantity), 0);

  it('lists it among the orders waiting for delivery, with its project and no prices', async () => {
    const po = await approvedProjectOrder();
    const listed = (await api.get<Array<Record<string, unknown> & { id: string; lines: Array<Record<string, unknown>> }>>('/purchase-orders/receivable')).find((o) => o.id === po.id)!;
    expect(listed).toMatchObject({ projectNumber: 'AFRI-1325', status: 'APPROVED' });
    expect(listed.lines[0]).not.toHaveProperty('unitPrice');
  });

  it('receives it into stock held for the project on Receive stock, not in one call', async () => {
    const po = await approvedProjectOrder();
    const before = await heldFor('AFRI-1325');
    await api.post('/goods-receipts', {
      supplierId: 'sup-1', purchaseOrderId: po.id, post: true, lines: [{ materialId: 'mat-9', locationId: 'loc-1', quantity: 1, purchaseOrderLineId: po.lines[0]!.id }],
    });
    expect(await heldFor('AFRI-1325')).toBe(before + 1);
    expect(await messageOf(api.post(`/purchase-orders/${po.id}/receive`, { locationId: 'loc-1' }))).toMatch(/received on Receive stock/);
    await receiveRest(po.id);
    expect((await api.get<Order>(`/purchase-orders/${po.id}`)).status).toBe('RECEIVED');
    expect(await heldFor('AFRI-1325')).toBe(before + 4);
  });

  it('no longer confirms a delivery on the order, of either kind', async () => {
    const po = await approvedProjectOrder();
    expect(await messageOf(api.post(`/purchase-orders/${po.id}/confirm-delivery`, { lines: [{ lineId: po.lines[0]!.id, quantity: 1 }] }))).toMatch(/received into stock now/);
    const stores = await api.post<Order>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 2, unitPrice: 5 }] });
    expect(await messageOf(api.post(`/purchase-orders/${stores.id}/confirm-delivery`, { lines: [{ lineId: stores.lines[0]!.id, quantity: 1 }] }))).toMatch(/received into stock now/);
  });
  // Qodo, PR #143: as the server refuses it.
  // Project Material Through the Store Roadmap, Phase 5, as the server moves it.
  it('moves a closed project\x27s held stock to Stores stock where it is, with its item', async () => {
    const po = await approvedProjectOrder();
    await receiveRest(po.id);
    const held = await heldFor('AFRI-1325');
    expect(held).toBeGreaterThan(0);
    await api.patch('/projects/AFRI-1325', { status: 'COMPLETED' });
    const listed = await api.get<{ items: Array<{ materialId: string; held: string }> }>('/projects/AFRI-1325/leftovers');
    expect(Number(listed.items.find((i) => i.materialId === 'mat-9')?.held)).toBe(held);
    expect(await api.post('/projects/AFRI-1325/leftovers/move', { items: [{ materialId: 'mat-9', category: 'CONSUMABLES' }] })).toEqual({ moved: 1 });
    expect(await heldFor('AFRI-1325')).toBe(0);
    expect((await api.get<{ category: string; projectNumber: string | null }>('/materials/mat-9'))).toMatchObject({ category: 'CONSUMABLES', projectNumber: null });
  });

  it('keeps an item held for another project as project material', async () => {
    const po = await approvedProjectOrder();
    await receiveRest(po.id);
    await api.patch('/projects/AFRI-1402', { status: 'COMPLETED' });
    expect(await messageOf(api.post('/projects/AFRI-1402/leftovers/move', { items: [{ materialId: 'mat-9', category: 'CONSUMABLES' }] })))
      .toMatch(/has stock in the store held for project AFRI-1325, so it stays project material/);
    expect((await api.get<{ category: string }>('/materials/mat-9')).category).toBe('PROJECT_MATERIAL');
  });
  // Qodo, PR #143: as the server values it, under the project it is held for.
  it('counts its value on the Dashboard under the project, with no stock status', async () => {
    type Value = { total: { value: number }; projects: Array<{ projectNumber: string | null; value: number; leftovers: number }>; status: Record<string, number> };
    const before = await api.get<Value>('/reports/stock-value');
    const po = await approvedProjectOrder();
    await receiveRest(po.id);
    const after = await api.get<Value>('/reports/stock-value');
    const project = (v: Value) => v.projects.find((p) => p.projectNumber === 'AFRI-1325')?.value ?? 0;
    const added = after.total.value - before.total.value;
    expect(added).toBeGreaterThan(0);
    expect(project(after) - project(before)).toBeCloseTo(added);
    expect(after.status).toEqual(before.status);
    // Held for the project: Move to Stores takes it once the project closes (Phase 5).
    const leftovers = (v: Value) => v.projects.find((p) => p.projectNumber === 'AFRI-1325')?.leftovers ?? 0;
    expect(leftovers(after)).toBeGreaterThanOrEqual(1);
  });
  // Project Material Through the Store Roadmap, Phase 3, as the server issues it.
  it('issues the stock to its project only, and moves it keeping its project', async () => {
    const po = await approvedProjectOrder();
    await receiveRest(po.id);
    const before = await heldFor('AFRI-1325');
    const issue = (projectNumber: string | undefined, quantity: number) => api.post('/inventory-issues', {
      recipientId: 'rcp-1', projectNumber, lines: [{ materialId: 'mat-9', locationId: 'loc-1', quantity, heldForProject: 'AFRI-1325' }],
    });
    expect(await messageOf(issue(undefined, 1))).toMatch(/held for project AFRI-1325: issue it to that project/);
    expect(await messageOf(issue('AFRI-1402', 1))).toMatch(/held for project AFRI-1325, so it can.t be issued to project AFRI-1402/);
    await issue('AFRI-1325', 1);
    expect(await heldFor('AFRI-1325')).toBe(before - 1);
    // A transfer keeps the project; Stores stock is untouched.
    await api.post('/inventory-transfers', { materialId: 'mat-9', fromLocationId: 'loc-1', toLocationId: 'loc-2', quantity: 1, heldForProject: 'AFRI-1325' });
    expect(await heldFor('AFRI-1325')).toBe(before - 1);
    // Its movements say whose stock moved, and the project's history finds the transfer (Qodo, PR #145).
    const rows = await api.get<Array<{ type: string; heldForProject: string | null }>>('/inventory-transactions?projectNumber=AFRI-1325');
    expect(rows.find((r) => r.type === 'TRANSFER_OUT')?.heldForProject).toBe('AFRI-1325');
    expect(rows.find((r) => r.type === 'RECEIPT')?.heldForProject).toBe('AFRI-1325');
  });
  // Qodo, PR #149, as the server: the move isn't reversed on its own, and
  // another project's item keeps what it is.
  it('refuses to reverse a move to Stores, and moves another project\'s item\'s stock without changing the item', async () => {
    // An item tagged to AFRI-1402, bought on AFRI-1325's order.
    await api.patch('/materials/mat-9', { projectNumber: 'AFRI-1402' });
    const created = await api.post<Order>('/purchase-orders', { supplierId: 'sup-1', projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', orderedQty: 4, unitPrice: 10 }] });
    const submitted = await api.post<Order>(`/purchase-orders/${created.id}/submit`, {});
    mockOrderRaisedBy(created.id, 'user-2'); // raised by someone else: nobody approves their own
    if (submitted.status === 'PENDING_APPROVAL') await api.post(`/purchase-orders/${created.id}/approve`, {});
    await receiveRest(created.id);
    await api.patch('/projects/AFRI-1325', { status: 'COMPLETED' });
    expect(await api.post('/projects/AFRI-1325/leftovers/move', { items: [{ materialId: 'mat-9' }] })).toEqual({ moved: 1 });
    expect(await heldFor('AFRI-1325')).toBe(0);
    expect(await api.get<{ category: string; projectNumber: string | null }>('/materials/mat-9')).toMatchObject({ category: 'PROJECT_MATERIAL', projectNumber: 'AFRI-1402' });
    const rows = await api.get<Array<{ id: string; type: string; referenceType?: string }>>('/inventory-transactions?materialId=mat-9');
    const out = rows.find((r) => r.type === 'TRANSFER_OUT' && r.referenceType === 'MoveToStores')!;
    expect(await messageOf(api.post(`/inventory-transactions/${out.id}/reversal`, { reason: 'Moved by mistake' }))).toMatch(/along with its item, so it isn.t reversed/);
  });
});

// As the server (system audit A6, A7): a receipt line goes back to the supplier, or is reversed, with its order.
describe('mock: putting a receipt against an order right', () => {
  type Row = { id: string; type: string; receiptId: string | null; receiptLineId: string | null; returnableToSupplier: string | null };

  it('sends goods back, owed again, and reverses a line with nothing sent back', async () => {
    const po = await approvedProjectOrder();
    await receiveRest(po.id);
    const rows = await api.get<Row[]>('/inventory-transactions?materialId=mat-9');
    const receipt = rows.find((r) => r.type === 'RECEIPT' && r.receiptLineId)!;
    expect(receipt.returnableToSupplier).toBe('4');
    await expect(api.post(`/goods-receipts/${receipt.receiptId}/lines/${receipt.receiptLineId}/return`, { quantity: 1 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await api.post(`/goods-receipts/${receipt.receiptId}/lines/${receipt.receiptLineId}/return`, { quantity: 1, reason: 'Wrong size', supplierReference: 'CN-1' });
    expect(await api.get<Order>(`/purchase-orders/${po.id}`)).toMatchObject({ status: 'PARTIALLY_RECEIVED', lines: [{ receivedQty: '3' }] });
    await expect(api.post(`/inventory-transactions/${receipt.id}/reversal`, { reason: 'Booked twice' })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const second = await approvedProjectOrder();
    await receiveRest(second.id);
    const other = (await api.get<Row[]>('/inventory-transactions?materialId=mat-9')).find((r) => r.type === 'RECEIPT' && r.receiptLineId && r.id !== receipt.id)!;
    await api.post(`/inventory-transactions/${other.id}/reversal`, { reason: 'Booked against the wrong order' });
    expect(await api.get<Order>(`/purchase-orders/${second.id}`)).toMatchObject({ status: 'APPROVED', lines: [{ receivedQty: '0' }] });
  });
});
