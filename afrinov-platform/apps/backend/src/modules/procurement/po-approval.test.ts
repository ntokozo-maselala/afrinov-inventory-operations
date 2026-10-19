// Approval by order value (procurement roadmap Phase 4).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/db.js', () => ({ prisma: {} }));
const { approvalBlock, approversFor, whoToAsk, withinLimit } = await import('./po-approval.js');

// R434 782.61 + 15% VAT = R500 000.00 (rounded per line).
const atLimit = { currency: 'ZAR', vatRate: 15, lines: [{ orderedQty: 1, unitPrice: '434782.61' }] };
const overLimit = { currency: 'ZAR', vatRate: 15, lines: [{ orderedQty: 1, unitPrice: '434782.62' }] };

describe('withinLimit', () => {
  it('has no ceiling without a limit, and compares rand totals with it', () => {
    expect(withinLimit(null, '9999999', 'ZAR')).toBe(true);
    expect(withinLimit('500000', '500000.00', 'ZAR')).toBe(true);
    expect(withinLimit('500000', '500000.01', 'ZAR')).toBe(false);
  });

  it('needs an approver without a limit for other currencies', () => {
    expect(withinLimit('500000', '10', 'EUR')).toBe(false);
    expect(withinLimit(null, '10', 'EUR')).toBe(true);
  });
});

describe('approvalBlock', () => {
  it('compares the total including VAT with the limit', () => {
    expect(approvalBlock(atLimit, '500000')).toBeNull();
    expect(approvalBlock(overLimit, '500000')).toEqual({
      code: 'OVER_LIMIT', message: expect.stringMatching(/^This order is R 500\s000,01 including VAT; your approval limit is R 500\s000,00\.$/),
    });
  });

  it('refuses while any line has no price, whatever the limit', () => {
    const po = { currency: 'ZAR', vatRate: 15, lines: [{ orderedQty: 1, unitPrice: 5 }, { orderedQty: 2, unitPrice: null }] };
    expect(approvalBlock(po, null)).toEqual({ code: 'UNPRICED', message: '1 line has no price. Add prices before approving, so the order total is known.' });
  });

  it('explains that a foreign-currency order needs an approver without a limit', () => {
    const po = { currency: 'EUR', vatRate: 0, lines: [{ orderedQty: 1, unitPrice: 100 }] };
    expect(approvalBlock(po, '500000')?.message).toBe('This order is in EUR. Approval limits are in rand, so it needs an approver without a limit.');
    expect(approvalBlock(po, null)).toBeNull();
  });
});

describe('approversFor', () => {
  const approvers = [
    { id: 'u-sb', name: 'Simbongile Bantubani', approvalLimit: null },
    { id: 'u-om', name: 'Ona Moloane', approvalLimit: '500000' },
  ];
  it('lists those whose limit covers the order', () => {
    expect(approversFor(atLimit, approvers).map((a) => a.name)).toEqual(['Simbongile Bantubani', 'Ona Moloane']);
    expect(approversFor(overLimit, approvers).map((a) => a.name)).toEqual(['Simbongile Bantubani']);
  });
  it('lists nobody while the order has unpriced lines', () => {
    expect(approversFor({ currency: 'ZAR', vatRate: 15, lines: [{ orderedQty: 1, unitPrice: null }] }, approvers)).toEqual([]);
  });
});

describe('whoToAsk', () => {
  it('names who can approve', () => {
    expect(whoToAsk(['Simbongile Bantubani'])).toBe('Ask Simbongile Bantubani to approve it.');
    expect(whoToAsk(['A', 'B', 'C'])).toBe('Ask A, B or C to approve it.');
    expect(whoToAsk([])).toMatch(/^Nobody has a high enough limit/);
  });
});
