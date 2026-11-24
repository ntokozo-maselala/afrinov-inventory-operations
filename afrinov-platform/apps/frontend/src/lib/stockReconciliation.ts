// What Admins are told about the daily stock check (ADR-047). The server runs
// it once a day and works out the state (GET /stock-reconciliation/status);
// this turns it into words, for the Dashboard card and Settings → Data & backup.
import { formatDateTime, formatNumber } from './format';
import type { Notice } from './backups';

export interface ReconciliationRun {
  status: 'OK' | 'DRIFT' | 'FAILED';
  startedAt: string;
  finishedAt: string;
  balances: number;
  issues: number;
  problemCount: number;
  problems: string[];
  detail: string | null;
}

export interface ReconciliationHealth {
  state: 'NONE' | 'OK' | 'DRIFT' | 'FAILED' | 'LATE';
  lastRun: ReconciliationRun | null;
}

const figures = (n: number) => `${formatNumber(n)} stock ${n === 1 ? 'figure doesn\'t' : 'figures don\'t'} add up`;

export function reconciliationNotice(h: ReconciliationHealth): Notice {
  const run = h.lastRun;
  switch (h.state) {
    case 'DRIFT':
      return {
        tone: 'danger',
        title: figures(run?.problemCount ?? 0),
        text: `The check on ${formatDateTime(run!.finishedAt)} found a balance that differs from its movements, or an issue that doesn't add up. Stock screens may be wrong for these items. Report it as a defect, with the list below.`,
      };
    case 'FAILED':
      return { tone: 'danger', title: 'The stock check could not run', text: `${run?.detail ?? 'No reason was given.'} It tries again within the hour.` };
    case 'LATE':
      return { tone: 'warning', title: 'No stock check in the last day', text: `The daily check may have stopped. Last one ${formatDateTime(run!.finishedAt)}.` };
    case 'NONE':
      return { tone: 'warning', title: 'No stock check yet', text: 'The server checks every stock figure once a day, starting soon after it starts.' };
    default:
      return {
        tone: 'success',
        title: 'Stock figures add up',
        text: `Checked ${formatDateTime(run!.finishedAt)}: ${formatNumber(run!.balances)} balances and ${formatNumber(run!.issues)} issues.`,
      };
  }
}

/** The Dashboard card: nothing while the figures add up. */
export function reconciliationCard(h: ReconciliationHealth | null | undefined) {
  if (!h || !['NONE', 'OK', 'DRIFT', 'FAILED', 'LATE'].includes(h.state) || h.state === 'OK') return null;
  const notice = reconciliationNotice(h);
  const value = h.state === 'DRIFT'
    ? `${formatNumber(h.lastRun?.problemCount ?? 0)} wrong`
    : { NONE: 'Not run', FAILED: 'Failed', LATE: 'Late' }[h.state];
  return { label: 'Stock check', value, tone: notice.tone === 'danger' ? 'danger' as const : 'warning' as const, note: notice.title, to: '/settings/data' };
}
