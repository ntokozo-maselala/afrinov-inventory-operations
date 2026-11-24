// What the hourly stock reconciliation tick writes to the log (ADR-047): drift
// and a failed check are error-level events to alert on; a clean run is info;
// a tick with nothing to do is silent.
import { describe, it, expect, vi } from 'vitest';
import { reportReconciliation } from './stock-reconciliation.job.js';
import type { ReconciliationRun } from './stock-reconciliation.js';

const run = (over: Partial<ReconciliationRun> = {}): ReconciliationRun => ({
  status: 'OK', startedAt: new Date('2026-11-23T02:00:00Z'), finishedAt: new Date('2026-11-23T02:00:02Z'),
  balances: 1138, issues: 40, problemCount: 0, problems: [], detail: null, ...over,
});
const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe('reportReconciliation', () => {
  it('logs a clean run at info', () => {
    const log = logger();
    reportReconciliation({ kind: 'ran', run: run() }, log);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'stock-reconciled', balances: 1138, issues: 40 }), expect.any(String));
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs drift at error as ledger-drift, with the count and the first problems', () => {
    const log = logger();
    const problems = Array.from({ length: 15 }, (_, i) => `RACE${i} at Shelf: stored balance 4, the ledger adds up to -2`);
    reportReconciliation({ kind: 'ran', run: run({ status: 'DRIFT', problemCount: 15, problems }) }, log);
    const [fields, message] = log.error.mock.calls[0]! as [Record<string, unknown>, string];
    expect(fields).toMatchObject({ event: 'ledger-drift', problemCount: 15 });
    expect(fields['problems']).toHaveLength(10);
    expect(message).toMatch(/do not add up/);
  });

  it('logs a check that could not run at error as stock-check-failed, with the error', () => {
    const log = logger();
    const error = new Error('boom');
    reportReconciliation({ kind: 'failed', run: run({ status: 'FAILED' }), error }, log);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'stock-check-failed', err: error }), expect.any(String));
  });

  it('says nothing when the tick had nothing to do', () => {
    const log = logger();
    reportReconciliation({ kind: 'skipped', reason: 'not-due' }, log);
    reportReconciliation({ kind: 'skipped', reason: 'busy' }, log);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});
