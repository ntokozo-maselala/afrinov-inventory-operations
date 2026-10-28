import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/db.js', () => ({ prisma: {} }));

const { createRfqSchema, updateRfqSchema, listRfqQuerySchema } = await import('./rfq.routes.js');

const line = { materialId: '20000000-0000-4000-8000-000000000001', quantity: 4.37 };

describe('request for quotation payloads', () => {
  it('needs at least one line, each with a positive quantity', () => {
    expect(createRfqSchema.safeParse({ lines: [] }).success).toBe(false);
    expect(createRfqSchema.safeParse({ lines: [{ ...line, quantity: 0 }] }).success).toBe(false);
    expect(createRfqSchema.parse({ lines: [line] })).toEqual({ lines: [line] });
  });

  it('takes readable supplier ids, as the seed gives', () => {
    expect(createRfqSchema.parse({ lines: [line], supplierIds: ['seed-sup-hydroscand'] }).supplierIds).toEqual(['seed-sup-hydroscand']);
    expect(createRfqSchema.safeParse({ lines: [line], supplierIds: [''] }).success).toBe(false);
  });

  it('leaves out of an edit what was not sent, and lets null clear a text field', () => {
    expect(updateRfqSchema.parse({})).toEqual({});
    expect(updateRfqSchema.parse({ projectNumber: null, notes: null })).toEqual({ projectNumber: null, notes: null });
    expect(updateRfqSchema.safeParse({ lines: [] }).success).toBe(false);
  });

  it('filters only by a known status', () => {
    expect(listRfqQuerySchema.parse({ status: 'SENT' })).toEqual({ status: 'SENT' });
    expect(listRfqQuerySchema.safeParse({ status: 'APPROVED' }).success).toBe(false);
  });
});
