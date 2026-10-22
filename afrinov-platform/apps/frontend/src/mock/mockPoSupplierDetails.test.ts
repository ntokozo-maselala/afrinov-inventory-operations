// The mock API takes the supplier details on a purchase order as the server
// does: the email by the supplier import's rule, the address tidied line by line.
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockApi, resetMockState } from './mockApi';

const api = createMockApi();
const codeOf = (p: Promise<unknown>) => p.then(() => undefined, (e: { code?: string }) => e.code);
const order = (details: Record<string, unknown>) =>
  api.post<{ id: string; supplierAddress: string | null; supplierContactEmail: string | null }>('/purchase-orders', {
    supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }], ...details,
  });

beforeEach(() => resetMockState());

describe('mock: supplier details on a purchase order', () => {
  it('refuses an email that is not one, or too long, on create and edit, changing nothing', async () => {
    expect(await codeOf(order({ supplierContactEmail: 'greg.coertzen-flex.com' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(order({ supplierContactEmail: `${'a'.repeat(310)}@example.com` }))).toBe('VALIDATION_ERROR');
    const po = await order({ supplierContactEmail: 'orders@example.com' });
    expect(await codeOf(api.patch(`/purchase-orders/${po.id}`, { supplierContactEmail: 'nope', notes: 'Changed' }))).toBe('VALIDATION_ERROR');
    expect(await api.get(`/purchase-orders/${po.id}`)).toMatchObject({ supplierContactEmail: 'orders@example.com', notes: undefined });
  });

  it('tidies an address line by line, dropping blank lines', async () => {
    const po = await order({ supplierAddress: '  Branch 2  \n\n   Roodekop   Industrial \n' });
    expect(po.supplierAddress).toBe('Branch 2\nRoodekop Industrial');
  });
});
