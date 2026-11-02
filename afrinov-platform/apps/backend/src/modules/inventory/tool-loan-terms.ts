// When a tool loan is due back, and what state it is in (04-processes/tool-loans.md).
//
// A loan has no stored state: it is worked out each time from its due date and
// today. The due date is agreed at check-out (dueOn on the LOAN row); a change
// (tool_loan_extensions) gives a later or earlier one, and the most recent
// change wins; a loan from before due dates falls due the default loan period
// after it went out. Dates are calendar days (YYYY-MM-DD),
// compared as whole UTC days, as purchase order due dates are.
//
// Pure functions only, so the rules are tested without a database.

/** The settings a loan is judged by (Settings > Inventory). */
export interface LoanTerms {
  /** inventory.toolOverdueDays: the default loan period. */
  defaultDays: number;
  /** inventory.toolMaxLoanDays: the longest loan from check-out, extensions included, short of an administrator. */
  maxDays: number;
  /** inventory.toolEscalateDays: days past due before a loan needs a decision. */
  escalateDays: number;
  /** inventory.toolOverdueCheckout: lending more to someone with an overdue tool. */
  overdueCheckout: 'warn' | 'block-contractors' | 'block';
}

export const TERM_SETTINGS = {
  defaultDays: 'inventory.toolOverdueDays',
  maxDays: 'inventory.toolMaxLoanDays',
  escalateDays: 'inventory.toolEscalateDays',
  overdueCheckout: 'inventory.toolOverdueCheckout',
} as const;

export const DEFAULT_TERMS: LoanTerms = { defaultDays: 7, maxDays: 30, escalateDays: 14, overdueCheckout: 'warn' };

/** Terms from a settings key→value map, falling back to the defaults. */
export function termsFrom(values: Record<string, unknown>): LoanTerms {
  const num = (key: string, fallback: number) => {
    const n = Number(values[key]);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
  };
  const policy = values[TERM_SETTINGS.overdueCheckout];
  return {
    defaultDays: num(TERM_SETTINGS.defaultDays, DEFAULT_TERMS.defaultDays),
    maxDays: num(TERM_SETTINGS.maxDays, DEFAULT_TERMS.maxDays),
    escalateDays: num(TERM_SETTINGS.escalateDays, DEFAULT_TERMS.escalateDays),
    overdueCheckout: policy === 'block' || policy === 'block-contractors' ? policy : 'warn',
  };
}

/**
 * ON_LOAN: within its period. DUE_SOON: due tomorrow or today. OVERDUE: past
 * due. NEEDS_DECISION: escalateDays or more past due, until it is checked in,
 * extended or written off as lost.
 */
export type LoanState = 'ON_LOAN' | 'DUE_SOON' | 'OVERDUE' | 'NEEDS_DECISION';

const DAY_MS = 86_400_000;
const toTime = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

/** The calendar day of a moment, as YYYY-MM-DD. */
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => dayOf(new Date(toTime(day) + n * DAY_MS));
/** Whole days from `from` to `to`, negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number => Math.round((toTime(to) - toTime(from)) / DAY_MS);

/** The due date a new loan gets when none is chosen: the default period, but not after the project ends (nor before today). */
export function defaultDueOn(today: string, terms: LoanTerms, projectEnd: string | null): string {
  const due = addDays(today, Math.min(terms.defaultDays, terms.maxDays));
  if (projectEnd && projectEnd < due) return projectEnd < today ? today : projectEnd;
  return due;
}

/**
 * Why `dueOn` is not allowed for a loan that went out on `outDay`, or null when
 * it is. Never before today; never after the project ends (when it has an end
 * date); and no more than maxDays after check-out unless `canExceedMax`.
 */
export function dueOnProblem(dueOn: string, args: {
  outDay: string; today: string; terms: LoanTerms; projectNumber?: string | null; projectEnd: string | null; canExceedMax: boolean;
}): string | null {
  const { outDay, today, terms, projectNumber, projectEnd, canExceedMax } = args;
  if (dueOn < today) return 'The due date cannot be before today.';
  // A project that has already ended allows today at the latest.
  if (projectEnd && dueOn > projectEnd && dueOn > today) {
    const project = projectNumber ? `Project ${projectNumber}` : 'The project';
    return `${project} ends on ${projectEnd}, so the tool is due back by then. Move the project's end date to lend it for longer.`;
  }
  const limit = addDays(outDay, terms.maxDays);
  if (!canExceedMax && dueOn > limit) {
    return `A tool can be lent for at most ${terms.maxDays} days, so it is due back by ${limit}. Only an administrator can set a later date.`;
  }
  return null;
}

/** One change of a loan's due date, later or earlier. */
export interface DueChange { id: string; at: Date; dueOn: string }

/** A loan's due dates over time: the one agreed at check-out, then each change, oldest first. */
export interface LoanDates { outDay: string; agreed: string; changes: DueChange[] }

/**
 * A loan's due dates from its row and its changes (any order). A loan from
 * before due dates was agreed the default period after it went out.
 */
export function loanDatesOf(
  loan: { postedAt: Date; dueOn: Date | null },
  changes: Array<{ id: string; createdAt: Date; dueOn: Date }>,
  terms: LoanTerms,
): LoanDates {
  const outDay = dayOf(loan.postedAt);
  return {
    outDay,
    agreed: loan.dueOn ? dayOf(loan.dueOn) : addDays(outDay, terms.defaultDays),
    changes: changes
      .map((c) => ({ id: c.id, at: c.createdAt, dueOn: dayOf(c.dueOn) }))
      .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : 1)),
  };
}

/** When a loan is due now: its most recent change, else the date agreed at check-out. */
export const currentDueOn = (d: LoanDates): string => d.changes.at(-1)?.dueOn ?? d.agreed;

/** When a loan was due at a moment: the most recent change made by then, else the agreed date. */
export function dueOnAt(d: LoanDates, at: Date): string {
  let due = d.agreed;
  for (const c of d.changes) if (c.at.getTime() <= at.getTime()) due = c.dueOn;
  return due;
}

/** The date a change replaced: the change before it, else the agreed date. */
export function dueOnBefore(d: LoanDates, changeId: string): string {
  const i = d.changes.findIndex((c) => c.id === changeId);
  return i > 0 ? d.changes[i - 1]!.dueOn : d.agreed;
}

/** A loan's state today, and how many days late it is (negative: days still to go). */
export function loanState(dueOn: string, today: string, terms: LoanTerms): { state: LoanState; daysLate: number } {
  const daysLate = daysBetween(dueOn, today);
  const state: LoanState = daysLate <= -2 ? 'ON_LOAN'
    : daysLate <= 0 ? 'DUE_SOON'
      : daysLate < terms.escalateDays ? 'OVERDUE'
        : 'NEEDS_DECISION';
  return { state, daysLate };
}

/** Whether a recipient with an overdue tool may be lent more, given the policy. */
export function overdueBlocksCheckout(terms: LoanTerms, recipientType: string): boolean {
  return terms.overdueCheckout === 'block' || (terms.overdueCheckout === 'block-contractors' && recipientType === 'CONTRACTOR');
}
