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

    expect(history[0]).toMatchObject({ action: 'CREATE', after: { number: po.number, status: 'DRAFT' } });
    const approval = history.find((e) => e.action === 'PO_APPROVE');
    expect(order.approvedBy).toBeDefined();
    expect(approval).toMatchObject({ actorId: order.approvedBy!.id, actorName: order.approvedBy!.name });
    expect(history.every((e) => e.actorName === history[0]!.actorName && e.actorName)).toBe(true);
  });
});
