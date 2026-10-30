// With procurement on, the mock books a delivery to the store only against an
// approved Stores order, as the server does.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { createMockApi, resetMockState } = await import('./mockApi');
const api = createMockApi();
beforeEach(() => resetMockState());

const messageOf = (p: Promise<unknown>) => p.then(() => undefined, (e: { message?: string }) => e.message);
const line = { materialId: 'mat-1', locationId: 'loc-1', quantity: 1 };

describe('mock: receiving with procurement on', () => {
  it('refuses a delivery with no order, by either way in', async () => {
    expect(await messageOf(api.post('/stock-receipts', { supplierId: 'sup-1', deliveryRef: 'INV-1', lines: [line] }))).toMatch(/booked against an approved Stores order/);
    expect(await messageOf(api.post('/goods-receipts', { supplierId: 'sup-1', deliveryRef: 'INV-1', lines: [line], post: true }))).toMatch(/booked against an approved Stores order/);
  });
});
