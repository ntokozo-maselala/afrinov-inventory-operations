// When a typed-in exchange rate was last changed, called out after 30 days (system audit D8).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = vi.hoisted(() => new Map<string, { value: unknown; updatedAt: Date }>());
vi.mock('../../shared/db.js', () => ({
  prisma: { setting: { findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null } },
}));
const { rateAge, RATE_STALE_DAYS } = await import('./po-approval.js');

const now = new Date('2026-11-15T08:00:00Z');
beforeEach(() => rows.clear());

describe('rateAge', () => {
  it('says when the rate was set and how many days ago', async () => {
    rows.set('purchaseOrders.exchangeRateEUR', { value: 19.8, updatedAt: new Date('2026-11-01T08:00:00Z') });
    expect(await rateAge('EUR', now)).toEqual({ setAt: '2026-11-01T08:00:00.000Z', days: 14, stale: false });
  });

  it(`calls a rate older than ${RATE_STALE_DAYS} days stale`, async () => {
    rows.set('purchaseOrders.exchangeRateUSD', { value: 18.2, updatedAt: new Date('2026-10-15T07:00:00Z') });
    expect(await rateAge('USD', now)).toMatchObject({ days: 31, stale: true });
    rows.set('purchaseOrders.exchangeRateUSD', { value: 18.2, updatedAt: new Date('2026-10-16T08:00:00Z') });
    expect(await rateAge('USD', now)).toMatchObject({ days: 30, stale: false });
  });

  it('says nothing for rand, or for a rate not set', async () => {
    rows.set('purchaseOrders.exchangeRateGBP', { value: 0, updatedAt: new Date('2025-01-01T00:00:00Z') });
    expect(await rateAge('ZAR', now)).toBeNull();
    expect(await rateAge('GBP', now)).toBeNull();
    expect(await rateAge('EUR', now)).toBeNull();
  });
});
