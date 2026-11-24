// The schedule and the log lines of the daily stock reconciliation (ADR-047).
// The service decides whether a check is due and records it; this ticks it
// hourly from the running server and says what happened. Drift and a failed
// check are error-level events (`ledger-drift`, `stock-check-failed`), so they
// can be alerted on as well as seen on the Dashboard.
import { StockReconciliationService, type ReconciliationOutcome } from './stock-reconciliation.js';

/** The part of the server's logger this needs. */
export interface ReconciliationLog {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/** Problems written to one log line; the run keeps more, the count is exact. */
const LOGGED_PROBLEMS = 10;

export function reportReconciliation(outcome: ReconciliationOutcome, log: ReconciliationLog): void {
  if (outcome.kind === 'skipped') return;
  if (outcome.kind === 'failed') {
    log.error({ event: 'stock-check-failed', err: outcome.error }, 'Stock reconciliation could not run, so the figures were not checked');
    return;
  }
  const { run } = outcome;
  if (run.status === 'DRIFT') {
    log.error(
      { event: 'ledger-drift', problemCount: run.problemCount, problems: run.problems.slice(0, LOGGED_PROBLEMS) },
      'Stock reconciliation found figures that do not add up: see Settings → Data & backup',
    );
    return;
  }
  log.info({ event: 'stock-reconciled', balances: run.balances, issues: run.issues }, 'Stock reconciliation: everything adds up');
}

/**
 * Ticks now and then hourly; the service runs the check once a day. Never
 * stops the server: a tick that throws is logged and the next one tries again.
 */
export function startStockReconciliation(log: ReconciliationLog, everyMs = 60 * 60 * 1000): NodeJS.Timeout {
  const tick = async () => {
    try {
      reportReconciliation(await StockReconciliationService.runIfDue(), log);
    } catch (err) {
      log.error({ event: 'stock-check-failed', err }, 'Stock reconciliation tick failed');
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return timer;
}
