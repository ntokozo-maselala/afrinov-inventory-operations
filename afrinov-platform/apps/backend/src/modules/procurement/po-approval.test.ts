// Who signs a purchase order: by value in rand excluding VAT, by role, in order.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/db.js', () => ({ prisma: {} }));
const { approvalState, exchangeRateOf, isStandIn, signRefusal, signsOrdersOfKind, whoToAsk } = await import('./po-approval.js');

const settings = { threshold: 200000, rates: { USD: 18, EUR: 0, GBP: 0 } };
const order = (price: string, extra: Record<string, unknown> = {}) => ({
  currency: 'ZAR', vatRate: 15, projectNumber: 'AFRI-1325', lines: [{ orderedQty: 1, unitPrice: price }], ...extra,
});

describe('approvalState', () => {
  it('asks the Procurement Manager alone under the threshold, excluding VAT', () => {
    // R229 999.99 with VAT, but R199 999.99 without it.
    expect(approvalState(order('199999.99'), settings)).toMatchObject({ block: null, randValue: '199999.99', steps: ['MANAGER'], next: 'MANAGER' });
  });

  it('asks both from exactly the threshold, the Procurement Manager first', () => {
    expect(approvalState(order('200000.00'), settings)).toMatchObject({ steps: ['MANAGER', 'DIRECTOR'], next: 'MANAGER' });
  });

  it('counts the discount: what is paid decides who signs', () => {
    const discounted = order('250000', { lines: [{ orderedQty: 1, unitPrice: '250000', discountPercent: '20.5' }] });
    expect(approvalState(discounted, settings)).toMatchObject({ randValue: '198750.00', steps: ['MANAGER'] });
  });

  it('moves to the Director once the Manager has signed, and to nobody after that', () => {
    const manager = { step: 'MANAGER' as const, signedById: 'm' };
    const director = { step: 'DIRECTOR' as const, signedById: 'd' };
    expect(approvalState(order('300000', { signatures: [manager] }), settings).next).toBe('DIRECTOR');
    expect(approvalState(order('300000', { signatures: [manager, director] }), settings).next).toBeNull();
  });

  it('asks only the Procurement Manager on a Stores order, at any value', () => {
    expect(approvalState(order('5000000', { projectNumber: null }), settings)).toMatchObject({ steps: ['MANAGER'], next: 'MANAGER' });
  });

  it('converts another currency at the locked rate, not today\'s', () => {
    const usd = (extra: Record<string, unknown> = {}) => order('11000', { currency: 'USD', vatRate: 0, ...extra });
    expect(approvalState(usd(), settings)).toMatchObject({ randValue: '198000.00', steps: ['MANAGER'] });
    expect(approvalState(usd({ exchangeRate: '20' }), settings)).toMatchObject({ randValue: '220000.00', steps: ['MANAGER', 'DIRECTOR'] });
  });

  it('is blocked without a rate, or while any line has no price', () => {
    expect(approvalState(order('10', { currency: 'EUR' }), settings).block).toMatchObject({ code: 'NO_RATE', message: expect.stringMatching(/^This order is in EUR/) });
    expect(approvalState(order('10', { lines: [{ orderedQty: 1 }] }), settings).block).toMatchObject({ code: 'UNPRICED', message: '1 line has no price. Add prices before approving, so the order total is known.' });
  });
});

describe('exchangeRateOf', () => {
  it('has none on a rand order, and takes the locked rate over today\'s', () => {
    expect(exchangeRateOf({ currency: 'ZAR' }, settings)).toBeNull();
    expect(exchangeRateOf({ currency: 'USD' }, settings)?.toString()).toBe('18');
    expect(exchangeRateOf({ currency: 'USD', exchangeRate: '17.5' }, settings)?.toString()).toBe('17.5');
    expect(exchangeRateOf({ currency: 'EUR' }, settings)).toBeNull();
  });
});

describe('signRefusal', () => {
  const big = order('300000');
  const refusal = (po: ReturnType<typeof order>, roles: string[], kind: 'projects' | 'stores' = 'projects', id = 'me') =>
    signRefusal(kind, approvalState(po, settings), po, { id, roles });

  it('lets the Procurement Manager or a stand-in sign the first step of a project order', () => {
    for (const role of ['PROCUREMENT_MANAGER', 'CEO', 'WORKSHOP_MANAGER']) expect(refusal(big, [role])).toBeNull();
  });

  it('keeps the Director waiting until the Manager has signed', () => {
    expect(refusal(big, ['DIRECTOR'])).toBe('The Procurement Manager signs this order first.');
    const signed = { ...big, signatures: [{ step: 'MANAGER' as const, signedById: 'm' }] };
    expect(refusal(signed, ['DIRECTOR'])).toBeNull();
    expect(refusal(signed, ['CEO'])).toBeNull();
    expect(refusal(signed, ['PROCUREMENT_MANAGER'])).toBe('This order is waiting on the Director.');
  });

  it('refuses someone signing the same order twice, whatever they hold', () => {
    const signed = { ...big, signatures: [{ step: 'MANAGER' as const, signedById: 'me' }] };
    expect(refusal(signed, ['PROCUREMENT_MANAGER', 'DIRECTOR'])).toBe('You have already signed this order. It is waiting on the Director.');
  });

  it('leaves Admin and the old Approver role out unless they hold a signing role', () => {
    expect(refusal(big, ['ADMIN'])).toBe('This order is waiting on the Procurement Manager.');
    expect(refusal(big, ['APPROVER'])).toBe('This order is waiting on the Procurement Manager.');
    expect(refusal(big, ['ADMIN', 'PROCUREMENT_MANAGER'])).toBeNull();
  });

  it('on a Stores order takes the Procurement Manager or Workshop Manager, not the CEO or Director', () => {
    const stores = order('1000', { projectNumber: null });
    expect(refusal(stores, ['PROCUREMENT_MANAGER'], 'stores')).toBeNull();
    expect(refusal(stores, ['WORKSHOP_MANAGER'], 'stores')).toBeNull();
    expect(refusal(stores, ['CEO'], 'stores')).toMatch(/waiting on the Procurement Manager/);
    expect(refusal(stores, ['DIRECTOR'], 'stores')).toMatch(/waiting on the Procurement Manager/);
    expect(refusal(stores, ['STORE_CONTROLLER'], 'stores')).toMatch(/waiting on the Procurement Manager/);
  });

  it('lets a signer finish an order signed in full, as when the threshold was raised part-way', () => {
    const signed = { ...order('1000'), signatures: [{ step: 'MANAGER' as const, signedById: 'me' }] };
    expect(refusal(signed, ['PROCUREMENT_MANAGER'])).toBeNull();
    expect(refusal(signed, ['VIEWER'])).toBe('This order has every signature it needs.');
  });
});

describe('roles', () => {
  it('tells who signs each kind of order', () => {
    expect(signsOrdersOfKind('projects', ['DIRECTOR'])).toBe(true);
    expect(signsOrdersOfKind('stores', ['DIRECTOR'])).toBe(false);
    expect(signsOrdersOfKind('stores', ['WORKSHOP_MANAGER'])).toBe(true);
    expect(signsOrdersOfKind('projects', ['ADMIN'])).toBe(false);
  });

  it('marks a signature by anyone but the usual signer as standing in', () => {
    expect(isStandIn('projects', 'MANAGER', ['PROCUREMENT_MANAGER'])).toBe(false);
    expect(isStandIn('projects', 'MANAGER', ['WORKSHOP_MANAGER'])).toBe(true);
    expect(isStandIn('projects', 'DIRECTOR', ['DIRECTOR', 'CEO'])).toBe(false);
    expect(isStandIn('projects', 'DIRECTOR', ['CEO'])).toBe(true);
  });
});

describe('whoToAsk', () => {
  it('names who can sign', () => {
    expect(whoToAsk(['Simbongile Bantubani'])).toBe('Ask Simbongile Bantubani to sign it.');
    expect(whoToAsk(['A', 'B', 'C'])).toBe('Ask A, B or C to sign it.');
    expect(whoToAsk([])).toMatch(/^Nobody holds that role yet/);
  });
});
