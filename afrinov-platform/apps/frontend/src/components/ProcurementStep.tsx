// What a schedule's Procurement step stands on (Project Tracking Roadmap,
// Phase 4): the project's purchase orders, and those of any project a joint
// schedule covers, from the orders and receipts the platform already holds.
// Nobody has to ask Procurement whether a job's material is in. No prices.
import { formatDay } from '../lib/projectSchedule';
import type { ScheduleStep, StepProcurement } from '../api/types';

/** The schedule's Procurement step: the first whose name says so. */
export function procurementStepOf<T extends Pick<ScheduleStep, 'name'>>(steps: T[]): T | undefined {
  return steps.find((s) => /procurement/i.test(s.name));
}

/** What to warn about, against the step's expected end. */
export function procurementWarnings(p: StepProcurement, stepEnd: string | null): string[] {
  const out: string[] = [];
  if (p.summary.overdue > 0) out.push(`${p.summary.overdue} order${p.summary.overdue === 1 ? ' is' : 's are'} overdue.`);
  if (stepEnd && p.summary.latestExpected && p.summary.latestExpected > stepEnd) {
    out.push(`Material is expected ${formatDay(p.summary.latestExpected)}, after this step is expected to end (${formatDay(stepEnd)}).`);
  }
  if (p.summary.closedShort > 0) {
    const n = p.summary.closedShort;
    out.push(`${n} order${n === 1 ? ' was' : 's were'} closed short: part of what ${n === 1 ? 'it' : 'they'} ordered never came. Check whether it is still needed before marking this step done.`);
  }
  if (p.summary.notPlaced > 0) out.push(`${p.summary.notPlaced} order${p.summary.notPlaced === 1 ? ' is' : 's are'} not placed yet (draft or waiting to be signed).`);
  return out;
}

/**
 * "3 orders · 1 owing", "All delivered, last 9 Mar 2026", or "No orders yet". When an order
 * was closed short nothing more is coming, but not everything came, so it never says "All delivered".
 */
export function procurementSummary(p: StepProcurement): string {
  const s = p.summary;
  if (s.orders === 0) return 'No orders yet';
  if (s.allReceived && s.closedShort > 0) {
    const short = `${s.closedShort} closed short`;
    return s.lastReceivedOn ? `Nothing more coming (${short}), last delivery ${formatDay(s.lastReceivedOn)}` : `Nothing more coming (${short})`;
  }
  if (s.allReceived) return s.lastReceivedOn ? `All delivered, last ${formatDay(s.lastReceivedOn)}` : 'All delivered';
  return `${s.orders} order${s.orders === 1 ? '' : 's'} · ${s.owing} owing`;
}

/** The step's line on the project page: how its orders stand and what to watch. */
export function ProcurementStepNote({ procurement: p, stepEnd, onMarkDone }: {
  procurement: StepProcurement;
  stepEnd: string | null;
  /** Offered when everything has arrived and the step isn't marked finished; nothing happens on its own. */
  onMarkDone?: () => void;
}) {
  const warnings = procurementWarnings(p, stepEnd);
  return (
    <div className="mt-1 text-xs space-y-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={!p.summary.allReceived ? 'text-surface-600' : p.summary.closedShort > 0 ? 'text-warning-700' : 'text-success-700'}>{procurementSummary(p)}</span>
        {onMarkDone && <button type="button" className="btn-link text-xs" onClick={onMarkDone}>Mark this step done</button>}
      </div>
      {warnings.map((w) => <div key={w} className="text-warning-700">{w}</div>)}
    </div>
  );
}
