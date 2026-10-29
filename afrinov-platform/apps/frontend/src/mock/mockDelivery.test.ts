// The mock confirms a project order's delivery and refuses to receive one into
// stock, as the server does (Stores and Procurement Separation Roadmap, Phase 3).
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockApi, resetMockState } from './mockApi';

const api = createMockApi();
beforeEach(() => resetMockState());

interface Order { id: string; status: string; lines: Array<{ id: string; receivedQty: string }> }
const messageOf = (p: Promise<unknown>) => p.then(() => undefined, (e: { message?: string }) => e.message);

/** An approved project order for 4 of AFRI-1325's plate. */
async function approvedProjectOrder(): Promise<Order> {
  await api.patch('/materials/mat-9', { projectNumber: 'AFRI-1325' });
  const po = await api.post<Order>('/purchase-orders', { supplierId: 'sup-1', projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', orderedQty: 4, unitPrice: 10 }] });
  const submitted = await api.post<Order>(`/purchase-orders/${po.id}/submit`, {});
  if (submitted.status === 'PENDING_APPROVAL') await api.post(`/purchase-orders/${po.id}/approve`, {});
  return api.get<Order>(`/purchase-orders/${po.id}`);
}

describe('mock: delivery of a project order', () => {
  it('confirms what arrived, line by line, then in full', async () => {
    const po = await approvedProjectOrder();
    const line = po.lines[0]!.id;
    expect((await api.post<Order>(`/purchase-orders/${po.id}/confirm-delivery`, { lines: [{ lineId: line, quantity: 1 }] })).status).toBe('PARTIALLY_RECEIVED');
    expect(await messageOf(api.post(`/purchase-orders/${po.id}/confirm-delivery`, { lines: [{ lineId: line, quantity: 4 }] }))).toMatch(/more than the 3 still outstanding/);
    const done = await api.post<Order>(`/purchase-orders/${po.id}/confirm-delivery`, { lines: [{ lineId: line, quantity: 3 }] });
    expect(done.status).toBe('RECEIVED');
    expect(Number(done.lines[0]!.receivedQty)).toBe(4);
  });

  it('refuses to receive it into stock, by either way in', async () => {
    const po = await approvedProjectOrder();
    expect(await messageOf(api.post(`/purchase-orders/${po.id}/receive`, { locationId: 'loc-1' }))).toMatch(/goes from the supplier straight to site/);
    expect(await messageOf(api.post('/goods-receipts', {
      supplierId: 'sup-1', purchaseOrderId: po.id, post: true, lines: [{ materialId: 'mat-9', locationId: 'loc-1', quantity: 1, purchaseOrderLineId: po.lines[0]!.id }],
    }))).toMatch(/goes from the supplier straight to site/);
  });

  it("doesn't confirm a Stores order, which is received into stock", async () => {
    const po = await api.post<Order>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 2, unitPrice: 5 }] });
    const submitted = await api.post<Order>(`/purchase-orders/${po.id}/submit`, {});
    if (submitted.status === 'PENDING_APPROVAL') await api.post(`/purchase-orders/${po.id}/approve`, {});
    expect(await messageOf(api.post(`/purchase-orders/${po.id}/confirm-delivery`, { lines: [{ lineId: po.lines[0]!.id, quantity: 1 }] }))).toMatch(/A Stores order is received into stock/);
  });
});
