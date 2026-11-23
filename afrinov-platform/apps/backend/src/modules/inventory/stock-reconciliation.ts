// The daily stock reconciliation (ADR-047).
//
// The stock floor constraint can only see one balance row at a time: it
// refuses a balance below zero, but not a balance that no longer equals the
// sum of its ledger lines (a path that wrote a line and never recomputed, a
// hand-made SQL change). PostgreSQL can't check that relationship, so once a
// day the backend runs the same check as `npm run check:issued-stock` and
// records what it found in `stock_reconciliation_runs`. Admins see the newest
// on the Dashboard, so a drift surfaces within a day instead of whenever
// someone thinks to look.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { checkIssuedStock, type IssuedStockCheck } from './issued-stock-check.js';

/** A day, checked hourly: due after 23 hours, so an early tick doesn't push it an hour later each day. */
export const RECONCILIATION_DUE_HOURS = 23;
/** No check finished for longer than this: the job may have stopped. A day with an hour's slack, as backups. */
export const RECONCILIATION_LATE_HOURS = 26;
/** Problems kept with a run; the count is always the true one. */
export const MAX_STORED_PROBLEMS = 50;
/** Runs kept for a year, then removed. */
export const RECONCILIATION_KEEP_DAYS = 366;

const LOCK = 'afrinov:stock-reconciliation';
const FAILED_DETAIL = 'The check could not finish, so the figures were not checked. The server log has the reason.';

export type ReconciliationStatus = 'OK' | 'DRIFT' | 'FAILED';
export type ReconciliationState = 'NONE' | 'OK' | 'DRIFT' | 'FAILED' | 'LATE';

/** A run as it is recorded. */
export interface ReconciliationRun {
  status: ReconciliationStatus;
  startedAt: Date;
  finishedAt: Date;
  balances: number;
  issues: number;
  problemCount: number;
  problems: string[];
  detail: string | null;
}

/** A run as the API returns it. */
export interface ReconciliationRunView extends Omit<ReconciliationRun, 'startedAt' | 'finishedAt'> {
  startedAt: string;
  finishedAt: string;
}

export interface ReconciliationHealth {
  state: ReconciliationState;
  lastRun: ReconciliationRunView | null;
}

/** What one hourly tick did. */
export type ReconciliationOutcome =
  | { kind: 'skipped'; reason: 'not-due' | 'busy' }
  | { kind: 'ran'; run: ReconciliationRun }
  | { kind: 'failed'; run: ReconciliationRun; error: unknown };

const hoursSince = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 3_600_000;

export function isReconciliationDue(lastStartedAt: string | null, now: Date): boolean {
  return lastStartedAt === null || hoursSince(lastStartedAt, now) >= RECONCILIATION_DUE_HOURS;
}

/**
 * What the newest run means for an Admin. Drift and a failed check stay as
 * they are however old: time passing doesn't make the figures add up. A clean
 * run older than a day means the job itself may have stopped.
 */
export function reconciliationHealth(last: ReconciliationRunView | null, now: Date): ReconciliationHealth {
  if (!last) return { state: 'NONE', lastRun: null };
  if (last.status === 'DRIFT' || last.status === 'FAILED') return { state: last.status, lastRun: last };
  return { state: hoursSince(last.finishedAt, now) > RECONCILIATION_LATE_HOURS ? 'LATE' : 'OK', lastRun: last };
}

/** A check's result as a run: DRIFT when anything does not add up. */
export function runFromCheck(check: IssuedStockCheck, startedAt: Date, finishedAt: Date): ReconciliationRun {
  return {
    status: check.problems.length === 0 ? 'OK' : 'DRIFT',
    startedAt,
    finishedAt,
    balances: check.balances,
    issues: check.issues,
    problemCount: check.problems.length,
    problems: check.problems.slice(0, MAX_STORED_PROBLEMS),
    detail: null,
  };
}

const toRow = (run: ReconciliationRun) => ({ ...run, problems: run.problems as Prisma.InputJsonValue });

function toView(row: {
  status: string; startedAt: Date; finishedAt: Date; balances: number; issues: number; problemCount: number; problems: Prisma.JsonValue; detail: string | null;
}): ReconciliationRunView {
  return {
    status: row.status as ReconciliationStatus,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    balances: row.balances,
    issues: row.issues,
    problemCount: row.problemCount,
    problems: Array.isArray(row.problems) ? row.problems.filter((p): p is string => typeof p === 'string') : [],
    detail: row.detail,
  };
}

export const StockReconciliationService = {
  /**
   * Runs the check if a day has passed since the last, and records it. One
   * transaction holds a try-lock, so two backend processes never both run it,
   * and reads at REPEATABLE READ, so balances, ledger and issues are compared
   * as they stood at one moment: a movement committing meanwhile can't look
   * like drift. If the check fails, a FAILED run is recorded instead.
   */
  async runIfDue(now = new Date()): Promise<ReconciliationOutcome> {
    const startedAt = now;
    try {
      return await prisma.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<Array<{ got: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK})) AS got`;
        if (!lock?.got) return { kind: 'skipped', reason: 'busy' } as const;
        const last = await tx.stockReconciliationRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true } });
        if (!isReconciliationDue(last?.startedAt.toISOString() ?? null, now)) return { kind: 'skipped', reason: 'not-due' } as const;

        const run = runFromCheck(await checkIssuedStock(tx), startedAt, new Date());
        await tx.stockReconciliationRun.create({ data: toRow(run) });
        await tx.stockReconciliationRun.deleteMany({
          where: { finishedAt: { lt: new Date(now.getTime() - RECONCILIATION_KEEP_DAYS * 86_400_000) } },
        });
        return { kind: 'ran', run } as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 });
    } catch (error) {
      const run: ReconciliationRun = {
        status: 'FAILED', startedAt, finishedAt: new Date(), balances: 0, issues: 0, problemCount: 0, problems: [], detail: FAILED_DETAIL,
      };
      // Best effort: if the database is down this fails too, and the run
      // stays unrecorded; the Dashboard then shows the check as late.
      await prisma.stockReconciliationRun.create({ data: toRow(run) }).catch(() => undefined);
      return { kind: 'failed', run, error };
    }
  },

  /** The newest run and what it means, for the Dashboard and Settings. */
  async health(now = new Date()): Promise<ReconciliationHealth> {
    const last = await prisma.stockReconciliationRun.findFirst({ orderBy: { finishedAt: 'desc' } });
    return reconciliationHealth(last ? toView(last) : null, now);
  },
};
