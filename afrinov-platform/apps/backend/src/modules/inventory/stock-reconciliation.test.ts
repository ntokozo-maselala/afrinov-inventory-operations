// The daily stock reconciliation (ADR-047): when it is due, what its last run
// means for an Admin, and how a check's result becomes a run. Pure rules; the
// integration suite runs it against a real database.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ $transaction: vi.fn(), stockReconciliationRun: { create: vi.fn(), deleteMany: vi.fn() } }));
vi.mock('../../shared/db.js', () => ({ prisma: db }));
const { checkIssuedStock } = vi.hoisted(() => ({ checkIssuedStock: vi.fn() }));
vi.mock('./issued-stock-check.js', () => ({ checkIssuedStock }));

import {
  MAX_STORED_PROBLEMS, RECONCILIATION_KEEP_DAYS, RECONCILIATION_LATE_HOURS, StockReconciliationService, isReconciliationDue, reconciliationHealth, runFromCheck,
  type ReconciliationRunView,
} from './stock-reconciliation.js';

const NOW = new Date('2026-11-23T10:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const run = (over: Partial<ReconciliationRunView> = {}): ReconciliationRunView => ({
  status: 'OK', startedAt: hoursAgo(2), finishedAt: hoursAgo(2), balances: 12, issues: 3, problemCount: 0, problems: [], detail: null, ...over,
});

describe('isReconciliationDue', () => {
  it('is due when it has never run', () => {
    expect(isReconciliationDue(null, NOW)).toBe(true);
  });

  it('runs once a day, checked hourly, without creeping later each day', () => {
    // An hourly tick a few seconds early must not wait a further hour.
    expect(isReconciliationDue(hoursAgo(22.9), NOW)).toBe(false);
    expect(isReconciliationDue(hoursAgo(23), NOW)).toBe(true);
    expect(isReconciliationDue(hoursAgo(30), NOW)).toBe(true);
  });
});

describe('reconciliationHealth', () => {
  it('says nothing has run yet', () => {
    expect(reconciliationHealth(null, NOW)).toEqual({ state: 'NONE', lastRun: null });
  });

  it('is OK after a recent clean run', () => {
    expect(reconciliationHealth(run(), NOW).state).toBe('OK');
  });

  it('reports drift when the last run found numbers that do not add up', () => {
    const drift = run({ status: 'DRIFT', problemCount: 2, problems: ['A at Shelf: stored balance 4, the ledger adds up to -2', 'B …'] });
    expect(reconciliationHealth(drift, NOW)).toEqual({ state: 'DRIFT', lastRun: drift });
  });

  it('reports a failed check apart from drift: the numbers were not checked at all', () => {
    expect(reconciliationHealth(run({ status: 'FAILED', detail: 'The database could not be reached.' }), NOW).state).toBe('FAILED');
  });

  it('is late when no check has finished for over a day, as the job may have stopped', () => {
    expect(reconciliationHealth(run({ finishedAt: hoursAgo(RECONCILIATION_LATE_HOURS + 1) }), NOW).state).toBe('LATE');
    // Drift stays drift however old: it is not cleared by time passing.
    expect(reconciliationHealth(run({ status: 'DRIFT', problemCount: 1, finishedAt: hoursAgo(40) }), NOW).state).toBe('DRIFT');
  });
});

describe('runFromCheck', () => {
  const started = new Date('2026-11-23T02:00:00.000Z');
  const finished = new Date('2026-11-23T02:00:03.000Z');

  it('is OK when everything adds up', () => {
    expect(runFromCheck({ balances: 12, issues: 3, problems: [] }, started, finished)).toEqual({
      status: 'OK', startedAt: started, finishedAt: finished, balances: 12, issues: 3, problemCount: 0, problems: [], detail: null,
    });
  });

  it('is DRIFT with the problems, keeping at most a bounded list but the true count', () => {
    const problems = Array.from({ length: MAX_STORED_PROBLEMS + 7 }, (_, i) => `problem ${i}`);
    const r = runFromCheck({ balances: 90, issues: 0, problems }, started, finished);
    expect(r.status).toBe('DRIFT');
    expect(r.problemCount).toBe(MAX_STORED_PROBLEMS + 7);
    expect(r.problems).toHaveLength(MAX_STORED_PROBLEMS);
    expect(r.problems[0]).toBe('problem 0');
  });
});

describe('StockReconciliationService.runIfDue when the check itself fails', () => {
  const driverError = Object.assign(new Error('Raw query failed: cannot reach db.internal:5432 as user afrinov'), { code: 'P2010' });
  beforeEach(() => {
    db.$transaction.mockReset();
    db.stockReconciliationRun.create.mockReset();
    db.stockReconciliationRun.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  });

  it('records a FAILED run in safe words, never the driver message, and does not throw', async () => {
    db.$transaction.mockRejectedValue(driverError);
    db.stockReconciliationRun.create.mockResolvedValue({});
    const outcome = await StockReconciliationService.runIfDue(new Date('2026-11-23T02:00:00.000Z'));

    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.error).toBe(driverError);
    const saved = db.stockReconciliationRun.create.mock.calls[0]![0].data as { status: string; detail: string };
    expect(saved.status).toBe('FAILED');
    expect(saved.detail).toMatch(/could not finish/);
    expect(saved.detail).not.toMatch(/db\.internal|5432|Raw query/);
  });

  it('still returns, unrecorded, when the database is down for the record too', async () => {
    db.$transaction.mockRejectedValue(driverError);
    db.stockReconciliationRun.create.mockRejectedValue(driverError);
    await expect(StockReconciliationService.runIfDue()).resolves.toMatchObject({ kind: 'failed' });
  });

  it('removes runs older than a year after recording a failure too, so a check failing for months keeps a bounded table', async () => {
    db.$transaction.mockRejectedValue(driverError);
    db.stockReconciliationRun.create.mockResolvedValue({});
    db.stockReconciliationRun.deleteMany.mockResolvedValue({ count: 0 });
    const now = new Date('2026-11-23T02:00:00.000Z');
    await StockReconciliationService.runIfDue(now);

    const cutoff = new Date(now.getTime() - RECONCILIATION_KEEP_DAYS * 86_400_000);
    expect(db.stockReconciliationRun.deleteMany).toHaveBeenCalledWith({ where: { finishedAt: { lt: cutoff } } });
  });
});

describe('StockReconciliationService.runIfDue after a failed check', () => {
  // The runs table, kept in memory: findFirst honours a status filter and
  // returns the newest by startedAt, as the real query does.
  type Row = { status: string; startedAt: Date };
  let rows: Row[];
  const newest = (args: { where?: { status?: { in: string[] } } }) =>
    rows.filter((r) => !args.where?.status || args.where.status.in.includes(r.status))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null;
  const save = async ({ data }: { data: Row }) => { rows.push(data); return data; };
  const tx = {
    $queryRaw: vi.fn(async () => [{ got: true }]),
    stockReconciliationRun: { findFirst: vi.fn(async (args: Parameters<typeof newest>[0]) => newest(args)), create: vi.fn(save), deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
  const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

  beforeEach(() => {
    rows = [];
    db.$transaction.mockReset().mockImplementation(async (work: (t: typeof tx) => unknown) => work(tx));
    db.stockReconciliationRun.create.mockReset().mockImplementation(save);
    db.stockReconciliationRun.deleteMany.mockReset().mockResolvedValue({ count: 0 });
    checkIssuedStock.mockReset();
  });

  // A failure is not the day's check: nothing was compared. Only a check that
  // finished (OK or DRIFT) starts the next 23 hours, so a failed one is tried
  // again at the next hourly tick, as the Dashboard and Settings say.
  it('records the failure, then runs at the next hourly tick, and only then waits a day', async () => {
    checkIssuedStock.mockRejectedValueOnce(new Error('connection reset'));
    expect((await StockReconciliationService.runIfDue(NOW)).kind).toBe('failed');
    expect(rows.map((r) => r.status)).toEqual(['FAILED']);

    checkIssuedStock.mockResolvedValue({ balances: 4, issues: 2, problems: [] });
    const retried = await StockReconciliationService.runIfDue(later(1));
    expect(retried.kind === 'ran' && retried.run.status).toBe('OK');

    expect(await StockReconciliationService.runIfDue(later(2))).toEqual({ kind: 'skipped', reason: 'not-due' });
    expect(rows.map((r) => r.status)).toEqual(['FAILED', 'OK']);
  });

  it('keeps trying each hour while the check keeps failing', async () => {
    checkIssuedStock.mockRejectedValue(new Error('connection reset'));
    for (const h of [0, 1, 2]) expect((await StockReconciliationService.runIfDue(later(h))).kind).toBe('failed');
    expect(rows.map((r) => r.status)).toEqual(['FAILED', 'FAILED', 'FAILED']);
  });
});
