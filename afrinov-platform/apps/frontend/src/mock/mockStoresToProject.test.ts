// As the server (ADR-043, reversing system audit E4): Stores stock has nothing
// to do with projects, so it is never issued to one.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Counter receipts, to put stock on the shelf without an order.
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: false }));
import { createMockApi, resetMockState } from './mockApi';

const api = createMockApi();
beforeEach(() => resetMockState());

describe('mock: Stores stock and projects', () => {
  it('refuses a Stores item on a project issue, straight or asked for, and issues it with no project', async () => {
    await api.post('/stock-receipts', { supplierId: 'sup-1', deliveryRef: 'E4-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 5 }] });
    const line = { materialId: 'mat-1', locationId: 'loc-1', quantity: 2 };
    await expect(api.post('/inventory-issues', { recipientId: 'rcp-1', projectNumber: 'AFRI-1325', lines: [line] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // Asked for approval, it finds nothing held for the project.
    await expect(api.post('/issue-requests', { recipientId: 'rcp-1', projectNumber: 'AFRI-1325', lines: [line] })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    const { transactionIds } = await api.post<{ transactionIds: string[] }>('/inventory-issues', { recipientId: 'rcp-1', lines: [line] });
    const rows = await api.get<Array<{ id: string; projectNumber?: string | null }>>('/inventory-transactions?materialId=mat-1');
    expect(rows.find((r) => r.id === transactionIds[0])?.projectNumber ?? null).toBeNull();
  });
});
