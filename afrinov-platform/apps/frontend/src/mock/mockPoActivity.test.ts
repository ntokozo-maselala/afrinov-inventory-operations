// The mock API keeps an order's Activity as the server does: an entry when it
// is created, and each entry named after the user it is by.
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockApi, resetMockState } from './mockApi';

const api = createMockApi();

beforeEach(() => resetMockState());

describe('mock: purchase order Activity', () => {
  it('starts with the order being created, and names the same user the order says approved it', async () => {
    const po = await api.post<{ id: string; number: string }>('/purchase-orders', {
      supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }],
    });
    await api.post(`/purchase-orders/${po.id}/submit`, {});
    await api.post(`/purchase-orders/${po.id}/approve`, {});

    const history = await api.get<Array<{ action: string; actorId: string | null; actorName: string | null; after: Record<string, unknown> | null }>>(`/purchase-orders/${po.id}/history`);
    const order = await api.get<{ status: string; approvedBy?: { id: string; name: string } }>(`/purchase-orders/${po.id}`);

    // Newest first, as the server returns it.
    expect(history.map((e) => e.action)).toEqual(['PO_APPROVE', 'PO_SUBMIT', 'CREATE']);
    expect(history.at(-1)).toMatchObject({ action: 'CREATE', after: { number: po.number, status: 'DRAFT' } });
    const approval = history.find((e) => e.action === 'PO_APPROVE');
    expect(order.approvedBy).toBeDefined();
    expect(approval).toMatchObject({ actorId: order.approvedBy!.id, actorName: order.approvedBy!.name });
    expect(history.every((e) => e.actorName === history[0]!.actorName && e.actorName)).toBe(true);
  });
});

// As the server: an order keeps the small print it was approved with, whether
// an approver approved it or submission did, with approval not required.
describe('mock: small print kept on approval', () => {
  type Order = { id: string; status: string; printedTerms?: Record<string, string> | null };
  const draft = () => api.post<Order>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 10 }] });

  it('keeps it when an approver approves the order', async () => {
    const po = await draft();
    expect((await api.post<Order>(`/purchase-orders/${po.id}/submit`, {})).printedTerms ?? null).toBeNull();
    const approved = await api.post<Order>(`/purchase-orders/${po.id}/approve`, {});
    expect(approved.printedTerms).toMatchObject({ invoiceEmail: 'accounts@afrinov.co.za', terms: expect.stringContaining('Purchase Order delivery date') });
  });

  it('keeps it when submission approves the order, with approval not required', async () => {
    // Settings outlive resetMockState, so it is put back however the test ends.
    await api.patch('/settings', { updates: { 'purchaseOrders.requireApprovalBeforeProcessing': false } });
    try {
      const po = await draft();
      const submitted = await api.post<Order>(`/purchase-orders/${po.id}/submit`, {});
      expect(submitted.status).toBe('APPROVED');
      expect(submitted.printedTerms).toMatchObject({ documentation: expect.stringContaining('Material Certificates') });
    } finally {
      await api.patch('/settings', { updates: { 'purchaseOrders.requireApprovalBeforeProcessing': true } });
    }
  });
});
