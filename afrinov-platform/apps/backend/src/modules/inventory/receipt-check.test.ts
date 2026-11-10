// Proof of receipt across a database (ADR-034): removing images past their
// keep period, and the check:receipts report. The Dashboard count's SQL runs
// against a real database in integration/receipts.real-http.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { settings, tx } = vi.hoisted(() => ({
  settings: { keep: 24 as number },
  tx: {
    receiptConfirmation: { findMany: vi.fn(), updateMany: vi.fn() },
    receiptImage: { deleteMany: vi.fn() },
  },
}));
vi.mock('../../shared/db.js', () => ({ prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }));
vi.mock('../settings/settings.service.js', () => ({ SettingsService: { getValue: async () => settings.keep } }));

const { checkReceipts, monthsBefore, pruneReceiptImages } = await import('./receipt-check.js');
const { slipFingerprint } = await import('./receipt-confirmation.service.js');

const NOW = new Date('2026-11-10T10:00:00.000Z');
const D = (n: number) => new Prisma.Decimal(n);

describe('monthsBefore', () => {
  it('counts calendar months back', () => {
    expect(monthsBefore(NOW, 24).toISOString()).toBe('2024-11-10T10:00:00.000Z');
    expect(monthsBefore(new Date('2026-03-31T00:00:00.000Z'), 1).getUTCMonth()).toBe(2); // 31 Feb rolls into March, as Date does
  });
});

describe('pruneReceiptImages', () => {
  beforeEach(() => {
    settings.keep = 24;
    tx.receiptConfirmation.findMany.mockReset().mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }]);
    tx.receiptConfirmation.updateMany.mockReset();
    tx.receiptImage.deleteMany.mockReset();
  });

  it('removes images older than the keep period and marks their records, keeping the records', async () => {
    expect(await pruneReceiptImages(NOW)).toBe(2);
    expect(tx.receiptConfirmation.findMany.mock.calls[0]![0].where).toEqual({ confirmedAt: { lt: new Date('2024-11-10T10:00:00.000Z') }, image: { isNot: null } });
    expect(tx.receiptImage.deleteMany).toHaveBeenCalledWith({ where: { confirmationId: { in: ['c-1', 'c-2'] } } });
    expect(tx.receiptConfirmation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['c-1', 'c-2'] } }, data: { imageRemovedAt: NOW } });
  });

  it('keeps every image when the setting is 0', async () => {
    settings.keep = 0;
    expect(await pruneReceiptImages(NOW)).toBe(0);
    expect(tx.receiptConfirmation.findMany).not.toHaveBeenCalled();
  });
});

describe('checkReceipts', () => {
  type Line = { id: string; issueId: string; quantity: Prisma.Decimal; postedAt: Date; recipientId: string | null; recipient: { type: string } | null; actor: { name: string }; reversedBy: { id: string } | null };
  const line = (id: string, issueId: string, daysAgo: number, over: Partial<Line> = {}): Line => ({
    id, issueId, quantity: D(-1), postedAt: new Date(NOW.getTime() - daysAgo * 86_400_000), recipientId: 'r-1', recipient: { type: 'WORKER' }, actor: { name: 'Vusi' }, reversedBy: null, ...over,
  });
  const conf = (slipId: string, over: Record<string, unknown>) => ({ slipId, method: 'PIN', reason: null, signerId: 'r-1', linesFingerprint: null, confirmedAt: NOW, imageRemovedAt: null, image: null, ...over });

  it('counts confirmations by method and waiting slips by age and issuer, and finds what changed or was disputed', async () => {
    const lines = [
      line('t-1', 's-pin', 2), line('t-2', 's-changed', 3, { reversedBy: { id: 'rev' } }), line('t-3', 's-changed', 3),
      line('t-4', 's-today', 0.2), line('t-5', 's-week', 3, { actor: { name: 'Thabo' } }), line('t-6', 's-old', 45),
      line('t-7', 's-disputed', 10), line('t-8', 's-gone', 5, { reversedBy: { id: 'rev2' } }),
    ];
    const db = {
      inventoryTransaction: { findMany: async () => lines },
      receiptConfirmation: { findMany: async () => [
        conf('s-pin', { linesFingerprint: slipFingerprint([{ id: 't-1', quantity: '-1' }]) }),
        conf('s-changed', { method: 'SIGNATURE', linesFingerprint: slipFingerprint([{ id: 't-2', quantity: '-1' }, { id: 't-3', quantity: '-1' }]), image: { size: 10 }, confirmedAt: new Date('2024-01-01') }),
        conf('s-disputed', { method: 'NONE', reason: 'DISPUTED', signerId: null }),
      ] },
      setting: { findUnique: async () => ({ value: 24 }) },
    };
    const r = await checkReceipts(db as never, NOW);
    expect(r.slips).toBe(7);
    expect(r.confirmed).toEqual({ PIN: 1, SIGNATURE: 1, PAPER: 0 });
    expect(r.changedAfter).toEqual(['s-changed']);
    expect(r.waiting).toEqual({ today: 1, week: 1, month: 1, older: 1 });
    expect(r.waitingByIssuer).toEqual([{ name: 'Vusi', slips: 3 }, { name: 'Thabo', slips: 1 }]);
    expect(r.disputed).toEqual(['s-disputed']);
    expect(r.imagesDue).toBe(1);
    expect(r.orphaned).toEqual([]);
    expect(r.wrongSigner).toEqual([]);
  });

  it('reports the rules broken: a confirmation with no slip, and a worker’s slip confirmed by someone else', async () => {
    const db = {
      inventoryTransaction: { findMany: async () => [line('t-1', 's-1', 1), line('t-2', 's-machine', 1, { recipientId: 'r-9', recipient: { type: 'MACHINE' } })] },
      receiptConfirmation: { findMany: async () => [
        conf('s-1', { signerId: 'r-2', linesFingerprint: 'x' }),
        conf('s-machine', { signerId: 'r-2', linesFingerprint: 'x' }),
        conf('s-missing', { linesFingerprint: 'x' }),
      ] },
      setting: { findUnique: async () => null },
    };
    const r = await checkReceipts(db as never, NOW);
    expect(r.wrongSigner).toEqual(['s-1']);
    expect(r.orphaned).toEqual(['s-missing']);
  });
});
