// Unit tests for ConsumableOutcomeService: marking issue lines of tracked
// consumables used up or broken, and withdrawing a mistake. The database is
// an in-memory fake with only what the service asks of it; the real queries
// are covered in integration/consumable-outcomes.real-http.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const D = (n: number) => new Prisma.Decimal(n);

interface Txn {
  id: string; type: string; quantity: Prisma.Decimal; materialId: string; locationId: string;
  reversesId?: string | null; referenceType?: string | null; referenceId?: string | null;
}
interface Outcome {
  id: string; issueTransactionId: string; outcome: 'USED_UP' | 'BROKEN'; quantity: Prisma.Decimal;
  note: string | null; withdrawsId: string | null; actorId: string; createdAt: Date;
}

const db = {
  txns: [] as Txn[],
  outcomes: [] as Outcome[],
  audit: [] as Array<{ action: string; entityId: string; after: Record<string, unknown> }>,
  locks: [] as string[],
  trackUse: new Map<string, boolean>(),
};
let seq = 0;
const names: Record<string, string> = { storeman: 'Vusi', controller: 'Thandi' };

const live = (o: Outcome) => !o.withdrawsId && !db.outcomes.some((w) => w.withdrawsId === o.id);

function client(): unknown {
  return {
    // The hold on the items' units (holdUnits) is left out: these are the balance locks.
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { if (!strings.join('').includes('FOR SHARE')) db.locks.push(String(values[0])); return 1; },
    inventoryTransaction: {
      // A reversal of the issue, looked for again under the lock.
      findFirst: async ({ where }: { where: { reversesId: string } }) => db.txns.find((x) => x.reversesId === where.reversesId) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => {
        const t = db.txns.find((x) => x.id === where.id);
        if (!t) return null;
        return {
          ...t,
          reversedBy: db.txns.some((x) => x.reversesId === t.id) ? { id: 'rev' } : null,
          material: { sku: `SKU-${t.materialId}`, name: `Item ${t.materialId}`, unitOfMeasure: 'each', trackUse: db.trackUse.get(t.materialId) ?? false },
        };
      },
      aggregate: async ({ where }: { where: { referenceId: string } }) => ({
        _sum: { quantity: db.txns.filter((x) => x.type === 'RETURN' && x.referenceId === where.referenceId).reduce((a, x) => a.plus(x.quantity), D(0)) },
      }),
    },
    // An item whose id starts "blade" is counted in each; the rest are measured.
    material: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => id.startsWith('blade')
          ? { id, name: `Item ${id}`, unitOfMeasure: 'each', unit: { kind: 'COUNTED' } }
          : { id, name: `Item ${id}`, unitOfMeasure: 'm', unit: { kind: 'MEASURED' } }),
    },
    consumableOutcome: {
      groupBy: async ({ where }: { where: { issueTransactionId: { in: string[] } } }) => {
        const out = new Map<string, { issueTransactionId: string; outcome: string; _sum: { quantity: Prisma.Decimal } }>();
        for (const o of db.outcomes.filter((x) => where.issueTransactionId.in.includes(x.issueTransactionId) && live(x))) {
          const g = out.get(`${o.issueTransactionId}|${o.outcome}`) ?? { issueTransactionId: o.issueTransactionId, outcome: o.outcome, _sum: { quantity: D(0) } };
          g._sum.quantity = g._sum.quantity.plus(o.quantity);
          out.set(`${o.issueTransactionId}|${o.outcome}`, g);
        }
        return [...out.values()];
      },
      create: async ({ data }: { data: Omit<Outcome, 'id' | 'createdAt' | 'note' | 'withdrawsId'> & { note?: string | null; withdrawsId?: string | null } }) => {
        const row: Outcome = { note: null, withdrawsId: null, ...data, id: `o-${++seq}`, createdAt: new Date(Date.UTC(2026, 10, 2, 8, seq)) };
        db.outcomes.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const o = db.outcomes.find((x) => x.id === where.id);
        if (!o) return null;
        const w = db.outcomes.find((x) => x.withdrawsId === o.id);
        return { ...o, withdrawnBy: w ? { id: w.id } : null, issue: db.txns.find((t) => t.id === o.issueTransactionId) };
      },
      findMany: async ({ where }: { where: { issueTransactionId: string } }) => db.outcomes
        .filter((o) => o.issueTransactionId === where.issueTransactionId)
        .map((o) => ({ ...o, actor: { name: names[o.actorId] ?? o.actorId } })),
    },
    auditLogEntry: { create: async ({ data }: { data: (typeof db.audit)[number] }) => { db.audit.push(data); return data; } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client()),
  };
}

vi.mock('../../shared/db.js', () => ({ get prisma() { return client(); } }));

const { ConsumableOutcomeService } = await import('./consumable-outcome.service.js');

/** An issue of 10 discs from loc-1, tracked unless said otherwise. */
function issue(id = 'iss-1', qty = 10, materialId = 'disc') {
  db.trackUse.set(materialId, db.trackUse.get(materialId) ?? true);
  db.txns.push({ id, type: 'ISSUE', quantity: D(-qty), materialId, locationId: 'loc-1' });
  return id;
}

beforeEach(() => {
  db.txns = [];
  db.outcomes = [];
  db.audit = [];
  db.locks = [];
  db.trackUse.clear();
  seq = 0;
});

describe('ConsumableOutcomeService.record', () => {
  it('closes off part of an issue and says where it now stands, with no stock moved', async () => {
    const id = issue();
    const r = await ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'USED_UP', quantity: 6, note: '  stubs back ', actorId: 'storeman' });
    expect(r).toEqual({ outcomeId: 'o-1', issued: '10', returned: '0', usedUp: '6', broken: '0', stillOut: '4' });
    expect(db.outcomes[0]).toMatchObject({ issueTransactionId: id, outcome: 'USED_UP', note: 'stubs back', actorId: 'storeman' });
    expect(db.txns).toHaveLength(1);
    expect(db.audit.at(-1)).toMatchObject({ action: 'CONSUMABLE_OUTCOME', entityId: id, after: { outcomeId: 'o-1', outcome: 'USED_UP', quantity: '6' } });
    // The lock a return against this issue takes too.
    expect(db.locks).toEqual(['afrinov:inventory-balance:disc:loc-1:']);
  });

  it('never closes off more than is still out, counting returns and earlier outcomes', async () => {
    const id = issue();
    db.txns.push({ id: 'ret-1', type: 'RETURN', quantity: D(3), materialId: 'disc', locationId: 'loc-1', referenceType: 'Return', referenceId: id });
    await ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'BROKEN', quantity: 2, actorId: 'storeman' });
    await expect(ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'USED_UP', quantity: 6, actorId: 'storeman' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Cannot mark 6 × SKU-disc: only 5 of the 10 issued is still out.' });
    const r = await ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'USED_UP', quantity: 5, actorId: 'storeman' });
    expect(r).toMatchObject({ returned: '3', usedUp: '5', broken: '2', stillOut: '0' });
  });

  // Qodo, PR #144: 0.00001 would be stored as zero in a four-decimal column.
  it('refuses a quantity finer than the four decimal places it is stored with, and writes nothing', async () => {
    const id = issue();
    await expect(ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'USED_UP', quantity: 0.00001, actorId: 'storeman' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Quantities can have at most 4 decimal places' });
    expect(db.outcomes).toHaveLength(0);
    const r = await ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'USED_UP', quantity: 0.0001, actorId: 'storeman' });
    expect(r.usedUp).toBe('0.0001');
  });

  it('refuses part of an item counted in whole units, and writes nothing', async () => {
    const id = issue('iss-blade', 10, 'blade-1');
    await expect(ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'BROKEN', quantity: 0.5, actorId: 'storeman' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Item blade-1 is counted in whole numbers (each). Enter 1, 2, 3 …' });
    expect(db.outcomes).toHaveLength(0);
    const r = await ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'BROKEN', quantity: 2, actorId: 'storeman' });
    expect(r.broken).toBe('2');
  });

  it('only takes an unreversed issue of an item that tracks use', async () => {
    await expect(ConsumableOutcomeService.record({ issueTransactionId: 'missing', outcome: 'USED_UP', quantity: 1, actorId: 'u' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    db.txns.push({ id: 'adj-1', type: 'ADJUSTMENT', quantity: D(5), materialId: 'disc', locationId: 'loc-1' });
    await expect(ConsumableOutcomeService.record({ issueTransactionId: 'adj-1', outcome: 'USED_UP', quantity: 1, actorId: 'u' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('Only an issue') });
    const reversed = issue('iss-2');
    db.txns.push({ id: 'rev-2', type: 'ISSUE', quantity: D(10), materialId: 'disc', locationId: 'loc-1', reversesId: reversed });
    await expect(ConsumableOutcomeService.record({ issueTransactionId: reversed, outcome: 'USED_UP', quantity: 1, actorId: 'u' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('has been reversed') });
    await expect(ConsumableOutcomeService.record({ issueTransactionId: 'rev-2', outcome: 'USED_UP', quantity: 1, actorId: 'u' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
    db.trackUse.set('glove', false);
    const untracked = issue('iss-3', 4, 'glove');
    await expect(ConsumableOutcomeService.record({ issueTransactionId: untracked, outcome: 'USED_UP', quantity: 1, actorId: 'u' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('does not track use') });
  });

  it('refuses a quantity that is not positive before reading anything', async () => {
    await expect(ConsumableOutcomeService.record({ issueTransactionId: issue(), outcome: 'BROKEN', quantity: 0, actorId: 'u' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.locks).toEqual([]);
  });
});

describe('ConsumableOutcomeService.withdraw', () => {
  it('adds a withdrawal naming the outcome, which then counts for nothing', async () => {
    const id = issue();
    const { outcomeId } = await ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'BROKEN', quantity: 4, actorId: 'storeman' });
    const r = await ConsumableOutcomeService.withdraw({ outcomeId, reason: ' Wrong worker ', actorId: 'controller' });
    expect(r).toEqual({ withdrawalId: 'o-2', issued: '10', returned: '0', usedUp: '0', broken: '0', stillOut: '10' });
    expect(db.outcomes[1]).toMatchObject({ withdrawsId: outcomeId, outcome: 'BROKEN', note: 'Wrong worker', actorId: 'controller' });
    expect(db.audit.at(-1)).toMatchObject({ action: 'CONSUMABLE_OUTCOME_WITHDRAW', entityId: id, after: { outcomeId, withdrawalId: 'o-2' } });
  });

  it('withdraws an outcome once, never a withdrawal, and wants a reason', async () => {
    const { outcomeId } = await ConsumableOutcomeService.record({ issueTransactionId: issue(), outcome: 'USED_UP', quantity: 1, actorId: 'storeman' });
    await expect(ConsumableOutcomeService.withdraw({ outcomeId, reason: 'no', actorId: 'u' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const { withdrawalId } = await ConsumableOutcomeService.withdraw({ outcomeId, reason: 'Booked twice', actorId: 'u' });
    await expect(ConsumableOutcomeService.withdraw({ outcomeId, reason: 'Booked twice', actorId: 'u' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(ConsumableOutcomeService.withdraw({ outcomeId: withdrawalId, reason: 'Undo the undo', actorId: 'u' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(ConsumableOutcomeService.withdraw({ outcomeId: 'missing', reason: 'Booked twice', actorId: 'u' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('ConsumableOutcomeService.forIssue', () => {
  it('lists every outcome oldest first, with its withdrawal on it', async () => {
    const id = issue();
    const { outcomeId } = await ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'USED_UP', quantity: 2, actorId: 'storeman' });
    await ConsumableOutcomeService.record({ issueTransactionId: id, outcome: 'BROKEN', quantity: 1, note: 'Shattered', actorId: 'storeman' });
    await ConsumableOutcomeService.withdraw({ outcomeId, reason: 'Wrong issue', actorId: 'controller' });
    const r = await ConsumableOutcomeService.forIssue(id);
    expect(r).toMatchObject({ issueTransactionId: id, sku: 'SKU-disc', trackUse: true, issued: '10', usedUp: '0', broken: '1', stillOut: '9' });
    expect(r.outcomes).toEqual([
      { id: 'o-1', outcome: 'USED_UP', quantity: '2', note: null, recordedBy: 'Vusi', recordedAt: expect.any(String), withdrawn: { by: 'Thandi', at: expect.any(String), reason: 'Wrong issue' } },
      { id: 'o-2', outcome: 'BROKEN', quantity: '1', note: 'Shattered', recordedBy: 'Vusi', recordedAt: expect.any(String), withdrawn: null },
    ]);
  });

  it('is only for an issue', async () => {
    db.txns.push({ id: 'adj-1', type: 'ADJUSTMENT', quantity: D(5), materialId: 'disc', locationId: 'loc-1' });
    await expect(ConsumableOutcomeService.forIssue('adj-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(ConsumableOutcomeService.forIssue('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
