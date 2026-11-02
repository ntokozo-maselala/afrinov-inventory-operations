// One tool loan from check-out to now (GET /tools/loans/:id/history), in the
// movement detail on Movements: the check-out, each due date change, the days
// it went overdue, and each check-in. Going overdue is worked out from the
// dates and shown as such; nothing is recorded for it.
import { useApi } from '../hooks/useApi';
import { Badge } from './Badge';
import { formatDateTime, formatNumber } from '../lib/format';
import { formatDay, LOAN_STATE, lateBy, lateness } from '../lib/toolLoans';
import type { LoanEvent, LoanHistory as LoanHistoryData } from '../api/types';

const CONDITION: Record<'GOOD' | 'DAMAGED' | 'LOST', string> = { GOOD: 'good', DAMAGED: 'damaged', LOST: 'lost' };

function Step({ event }: { event: LoanEvent }) {
  switch (event.kind) {
    case 'CHECKED_OUT':
      return (
        <>
          <p className="font-medium text-surface-900">Checked out, {formatNumber(Number(event.quantity))}</p>
          <p className="text-surface-600">Due back {formatDay(event.dueOn)}. By {event.by}.</p>
          {event.note && <p className="text-surface-600">{event.note}</p>}
          {event.overdueOverrideReason && <p className="text-warning-700">Lent while overdue: {event.overdueOverrideReason}</p>}
        </>
      );
    case 'DUE_DATE_CHANGED':
      return (
        <>
          <p className="font-medium text-surface-900">
            Due date moved {event.dueOn > event.previousDueOn ? 'later' : 'earlier'}: {formatDay(event.previousDueOn)} → {formatDay(event.dueOn)}
          </p>
          <p className="text-surface-600">{event.reason} By {event.by}.</p>
        </>
      );
    case 'BECAME_OVERDUE':
      return (
        <>
          <p className="italic text-surface-500">Became overdue</p>
          <p className="text-surface-500">It was due back {formatDay(event.dueOn)}. Worked out from the date; nothing is recorded.</p>
        </>
      );
    case 'CHECKED_IN':
      return (
        <>
          <p className="font-medium text-surface-900">Checked in, {formatNumber(Number(event.quantity))}, {CONDITION[event.condition]}</p>
          <p className={event.daysLate > 0 ? 'text-danger-700' : 'text-surface-600'}>
            {lateBy(event.daysLate)} (due {formatDay(event.dueOn)}). By {event.by}.
          </p>
          {event.note && <p className="text-surface-600">{event.note}</p>}
        </>
      );
  }
}

const DOT: Record<LoanEvent['kind'], string> = {
  CHECKED_OUT: 'bg-danger-500 border-danger-500',
  DUE_DATE_CHANGED: 'bg-warning-500 border-warning-500',
  BECAME_OVERDUE: 'bg-surface-0 border-surface-400 border-dashed',
  CHECKED_IN: 'bg-success-500 border-success-500',
};

export function LoanHistory({ loanId }: { loanId: string }) {
  const history = useApi<LoanHistoryData>(`/tools/loans/${loanId}/history`);
  const h = history.data;
  return (
    <section className="space-y-3 border-t border-surface-200 pt-4" aria-labelledby="loan-history">
      <h3 id="loan-history" className="text-h3 text-surface-900">This loan, start to finish</h3>
      {history.error && !h && <p className="text-sm text-surface-600">The loan&apos;s history couldn&apos;t be loaded.</p>}
      {history.loading && !h && <p className="text-meta">Loading…</p>}
      {h && (
        <>
          <p className="text-sm text-surface-600">
            {h.sku} {h.name} · {h.recipientName ?? 'Not recorded'}{h.projectNumber ? ` · ${h.projectNumber}` : ''}
          </p>
          <ol className="text-sm">
            {h.events.map((e, i) => (
              <li key={`${e.kind}-${e.at}-${i}`} className="relative pl-6 pb-4 last:pb-0">
                {i < h.events.length - 1 && <span aria-hidden className="absolute left-[5px] top-3 bottom-0 w-px bg-surface-200" />}
                <span aria-hidden className={`absolute left-0 top-1 h-3 w-3 rounded-full border-2 ${DOT[e.kind]}`} />
                <p className="text-meta">{e.kind === 'BECAME_OVERDUE' ? formatDay(e.at.slice(0, 10)) : formatDateTime(e.at)}</p>
                <Step event={e} />
              </li>
            ))}
          </ol>
          <p className="text-sm">
            {h.state
              ? <><Badge tone={LOAN_STATE[h.state].tone}>{LOAN_STATE[h.state].label}</Badge> {formatNumber(Number(h.out))} still out, {lateness(h)} ({formatDay(h.dueOn)}).</>
              : <span className="text-surface-600">All back.</span>}
          </p>
        </>
      )}
    </section>
  );
}
