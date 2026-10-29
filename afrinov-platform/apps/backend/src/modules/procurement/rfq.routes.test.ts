import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/db.js', () => ({ prisma: {} }));

const { createRfqSchema, updateRfqSchema, listRfqQuerySchema, fourDecimals } = await import('./rfq.routes.js');

const line = { materialId: '20000000-0000-4000-8000-000000000001', quantity: 4.37 };

describe('request for quotation payloads', () => {
  it('needs at least one line, each with a positive quantity', () => {
    expect(createRfqSchema.safeParse({ lines: [] }).success).toBe(false);
    expect(createRfqSchema.safeParse({ lines: [{ ...line, quantity: 0 }] }).success).toBe(false);
    expect(createRfqSchema.parse({ lines: [line] })).toEqual({ lines: [line] });
  });

  it('keeps quantities to the 4 decimal places they are saved with', () => {
    expect(createRfqSchema.parse({ lines: [{ ...line, quantity: 0.0001 }] }).lines[0]!.quantity).toBe(0.0001);
    expect(createRfqSchema.parse({ lines: [{ ...line, quantity: 254.466 }] }).lines[0]!.quantity).toBe(254.466);
    expect(createRfqSchema.safeParse({ lines: [{ ...line, quantity: 0.00001 }] }).success).toBe(false);
    expect(createRfqSchema.safeParse({ lines: [{ ...line, quantity: 1.23456 }] }).success).toBe(false);
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

describe('quote prices', () => {
  it('keeps prices to the 4 decimal places they are saved with, large or tiny', () => {
    for (const ok of [0, 160, 254.466, 12.3456, 0.0001, 999_999_999_999.9999, 1e12]) expect(fourDecimals(ok)).toBe(true);
    for (const bad of [1.23456, 0.00001, 0.000000001, 0.1 + 0.00004]) expect(fourDecimals(bad)).toBe(false);
  });
});
