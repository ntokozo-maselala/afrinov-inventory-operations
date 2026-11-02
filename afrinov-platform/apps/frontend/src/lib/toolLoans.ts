// Tool loan due dates on the client: the loan rules from Settings > Inventory,
// the due date a check-out form suggests, and how a loan's state reads. The
// server decides (apps/backend/src/modules/inventory/tool-loan-terms.ts); this
// only pre-fills the form and labels what GET /tools returns.
import { useApi } from '../hooks/useApi';
import { formatDate } from './format';
import type { LoanState, OpenLoan } from '../api/types';

/** A calendar day (YYYY-MM-DD) in the app's date format. Read at midday, so no time zone moves it to another day. */
export const formatDay = (day: string): string => formatDate(`${day}T12:00:00`);

export interface LoanTerms {
  defaultDays: number;
  maxDays: number;
  escalateDays: number;
  overdueCheckout: 'warn' | 'block-contractors' | 'block';
}

const KEYS = {
  defaultDays: 'inventory.toolOverdueDays',
  maxDays: 'inventory.toolMaxLoanDays',
  escalateDays: 'inventory.toolEscalateDays',
  overdueCheckout: 'inventory.toolOverdueCheckout',
} as const;

export const DEFAULT_TERMS: LoanTerms = { defaultDays: 7, maxDays: 30, escalateDays: 14, overdueCheckout: 'warn' };

/** The loan rules, with the defaults until (or unless) the settings load. */
export function useLoanTerms(): LoanTerms {
  const values = useApi<Record<string, unknown>>(`/settings/values?keys=${Object.values(KEYS).join(',')}`);
  const v = values.data ?? {};
  const num = (key: string, fallback: number) => {
    const n = Number(v[key]);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
  };
  const policy = v[KEYS.overdueCheckout];
  return {
    defaultDays: num(KEYS.defaultDays, DEFAULT_TERMS.defaultDays),
    maxDays: num(KEYS.maxDays, DEFAULT_TERMS.maxDays),
    escalateDays: num(KEYS.escalateDays, DEFAULT_TERMS.escalateDays),
    overdueCheckout: policy === 'block' || policy === 'block-contractors' ? policy : 'warn',
  };
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The due date to suggest, and why: the loan period from today, but not after the project ends. */
export function suggestedDueOn(from: string, terms: LoanTerms, projectEnd: string | null): { dueOn: string; rule: string } {
  const days = Math.min(terms.defaultDays, terms.maxDays);
  const due = addDays(from, days);
  if (projectEnd && projectEnd < due) return { dueOn: projectEnd < from ? from : projectEnd, rule: 'the project end date' };
  return { dueOn: due, rule: `the ${days}-day loan period` };
}

/** The latest due date the form offers: the longest loan from check-out, and the project end. */
export function latestDueOn(outDay: string, terms: LoanTerms, projectEnd: string | null, canExceedMax: boolean): string | undefined {
  const caps = [canExceedMax ? null : addDays(outDay, terms.maxDays), projectEnd ? (projectEnd < outDay ? outDay : projectEnd) : null]
    .filter((d): d is string => d !== null);
  return caps.length ? caps.sort()[0] : undefined;
}

/** Whether the policy refuses lending to this recipient while they have an overdue tool. */
export function overdueBlocks(terms: LoanTerms, recipientType: string | undefined): boolean {
  return terms.overdueCheckout === 'block' || (terms.overdueCheckout === 'block-contractors' && recipientType === 'CONTRACTOR');
}

export const LOAN_STATE: Record<LoanState, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  ON_LOAN: { label: 'On loan', tone: 'success' },
  DUE_SOON: { label: 'Due soon', tone: 'warning' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
  NEEDS_DECISION: { label: 'Needs a decision', tone: 'danger' },
};

/** "due in 3 days", "due today", "2 days late". */
export function lateness(loan: Pick<OpenLoan, 'daysLate'>): string {
  const n = Math.abs(loan.daysLate);
  const days = `${n} day${n === 1 ? '' : 's'}`;
  if (loan.daysLate === 0) return 'due today';
  if (loan.daysLate === -1) return 'due tomorrow';
  return loan.daysLate < 0 ? `due in ${days}` : `${days} late`;
}

/** How a check-in compares with its due date: "On time", "1 day late". */
export function lateBy(daysLate: number): string {
  return daysLate > 0 ? `${daysLate} day${daysLate === 1 ? '' : 's'} late` : 'On time';
}

/** Which way a due date change went. */
export const movedWay = (previousDueOn: string, dueOn: string): 'later' | 'earlier' => (dueOn > previousDueOn ? 'later' : 'earlier');
