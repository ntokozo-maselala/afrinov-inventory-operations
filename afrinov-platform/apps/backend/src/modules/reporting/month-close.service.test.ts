// Closing a month keeps its figures (system audit G1, ADR-041).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const db = vi.hoisted(() => ({
  closes: new Map<string, { month: string; closedAt: Date; closedById: string; report: unknown }>(),
  prices: [] as Array<{ month: string; materialId: string; unitCost: unknown }>,
  audit: [] as Array<{ action: string; entityId: string; after?: unknown }>,
}));

vi.mock('../../shared/db.js', () => {
  const client = {
    monthClose: {
      findUnique: async ({ where }: { where: { month: string } }) => {
        const row = db.closes.get(where.month);
        return row ? { ...row, closedBy: { name: 'Admin' } } : null;
      },
      findMany: async () => [...db.closes.values()].sort((a, b) => b.month.localeCompare(a.month)).map((r) => ({ ...r, closedBy: { name: 'Admin' } })),
      create: async ({ data }: { data: { month: string; closedById: string; report: unknown } }) => {
        const row = { ...data, closedAt: new Date('2026-11-02T08:00:00Z') };
        db.closes.set(data.month, row);
        return { ...row, closedBy: { name: 'Admin' } };
      },
      delete: async ({ where }: { where: { month: string } }) => {
        db.closes.delete(where.month);
        db.prices = db.prices.filter((p) => p.month !== where.month);
      },
    },
    monthClosePrice: {
      createMany: async ({ data }: { data: typeof db.prices }) => { db.prices.push(...data); return { count: data.length }; },
      findMany: async ({ where }: { where: { month: { in: string[] } } }) => db.prices.filter((p) => where.month.in.includes(p.month)),
    },
    material: { findMany: async () => [{ id: 'm-1', unitCost: new Prisma.Decimal(12.5) }, { id: 'm-2', unitCost: null }] },
    auditLogEntry: { create: async ({ data }: { data: (typeof db.audit)[number] }) => { db.audit.push(data); return data; } },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
  };
  return { prisma: client };
});

const { MonthCloseService } = await import('./month-close.service.js');

const report = (value: number) => ({
  month: '2026-09', from: '2026-09-01', to: '2026-09-30', generatedAt: '2026-10-01T06:00:00.000Z', currency: 'ZAR',
  bands: { urgentBelowPercent: 25, warningBelowPercent: 60 }, categories: [], projects: [],
  total: { items: 2, itemsInStock: 1, value, urgent: 0, warning: 0, usedValue: 40 },
});

beforeEach(() => { db.closes.clear(); db.prices = []; db.audit = []; });

describe('MonthCloseService', () => {
  const now = new Date('2026-11-02T08:00:00Z');

  it('closes a month that is over, keeping its report and every item\'s unit cost then', async () => {
    const closed = await MonthCloseService.close('2026-09', 'u-admin', async () => report(1250), now);
    expect(closed).toEqual({ month: '2026-09', closedAt: '2026-11-02T08:00:00.000Z', closedBy: 'Admin' });
    expect((await MonthCloseService.kept('2026-09'))?.report.total.value).toBe(1250);
    const prices = await MonthCloseService.pricesFor(['2026-09', '2026-10']);
    expect([...prices.keys()]).toEqual(['2026-09']);
    expect(prices.get('2026-09')).toEqual(new Map([['m-1', 12.5], ['m-2', null]]));
    expect(db.audit.at(-1)).toMatchObject({ action: 'MONTH_CLOSE', entityId: '2026-09' });
  });

  it('refuses a month not over yet, a malformed one, or one closed already', async () => {
    await expect(MonthCloseService.close('2026-11', 'u-admin', async () => report(0), now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(MonthCloseService.close('2026-9', 'u-admin', async () => report(0), now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await MonthCloseService.close('2026-09', 'u-admin', async () => report(0), now);
    await expect(MonthCloseService.close('2026-09', 'u-admin', async () => report(0), now)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('opens a closed month again only with a reason, and drops what was kept', async () => {
    await MonthCloseService.close('2026-09', 'u-admin', async () => report(1250), now);
    await expect(MonthCloseService.reopen('2026-09', ' ', 'u-admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await MonthCloseService.reopen('2026-09', 'Invoice prices corrected', 'u-admin');
    expect(await MonthCloseService.kept('2026-09')).toBeNull();
    expect((await MonthCloseService.pricesFor(['2026-09'])).size).toBe(0);
    expect(db.audit.at(-1)).toMatchObject({ action: 'MONTH_REOPEN', after: { reason: 'Invoice prices corrected' } });
    await expect(MonthCloseService.reopen('2026-09', 'Again', 'u-admin')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
