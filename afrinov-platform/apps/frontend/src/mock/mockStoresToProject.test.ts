// As the server (system audit E4): a Stores item issued to a project is charged to it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Counter receipts, to put stock on the shelf without an order.
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: false }));
import { createMockApi, resetMockState } from './mockApi';

const api = createMockApi();
beforeEach(() => resetMockState());

describe('mock: Stores items on a project issue', () => {
  it('issues a Stores item to an open project, and the movement names the project', async () => {
    await api.post('/stock-receipts', { supplierId: 'sup-1', deliveryRef: 'E4-1', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 5 }] });
    const { transactionIds } = await api.post<{ transactionIds: string[] }>('/inventory-issues', {
      recipientId: 'rcp-1', projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 2 }],
    });
    const rows = await api.get<Array<{ id: string; projectNumber?: string | null }>>('/inventory-transactions?materialId=mat-1');
    expect(rows.find((r) => r.id === transactionIds[0])?.projectNumber).toBe('AFRI-1325');
  });
});
