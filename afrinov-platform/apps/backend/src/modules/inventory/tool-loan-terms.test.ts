// The tool loan rules on their own: when a loan is due, which due dates are
// allowed, and what state a loan is in on a given day.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TERMS, addDays, currentDueOn, daysBetween, defaultDueOn, dueOnAt, dueOnBefore, dueOnProblem, loanDatesOf, loanState,
  overdueBlocksCheckout, termsFrom,
} from './tool-loan-terms.js';

const terms = DEFAULT_TERMS; // 7-day period, 30 at most, a decision 14 days late, warn

describe('tool loan terms', () => {
  it('counts calendar days across month ends', () => {
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(daysBetween('2026-11-04', '2026-11-02')).toBe(-2);
    expect(daysBetween('2026-10-28', '2026-11-04')).toBe(7);
  });

  it('reads the settings, falling back to the defaults for anything missing or unusable', () => {
    expect(termsFrom({})).toEqual(DEFAULT_TERMS);
    expect(termsFrom({
      'inventory.toolOverdueDays': 3, 'inventory.toolMaxLoanDays': 60, 'inventory.toolEscalateDays': 'x', 'inventory.toolOverdueCheckout': 'block',
    })).toEqual({ defaultDays: 3, maxDays: 60, escalateDays: 14, overdueCheckout: 'block' });
  });

  it('defaults a new loan to the loan period, but not past the project end, nor before today', () => {
    expect(defaultDueOn('2026-10-28', terms, null)).toBe('2026-11-04');
    expect(defaultDueOn('2026-10-28', terms, '2026-11-02')).toBe('2026-11-02');
    expect(defaultDueOn('2026-10-28', terms, '2026-12-31')).toBe('2026-11-04');
    expect(defaultDueOn('2026-10-28', terms, '2026-10-01')).toBe('2026-10-28');
    // A default period longer than the longest loan is held to the longest.
    expect(defaultDueOn('2026-10-28', { ...terms, defaultDays: 45 }, null)).toBe('2026-11-27');
  });

  it('allows a due date from today up to the longest loan, within the project', () => {
    const args = { outDay: '2026-10-28', today: '2026-10-28', terms, projectEnd: null, canExceedMax: false };
    expect(dueOnProblem('2026-10-28', args)).toBeNull();
    expect(dueOnProblem('2026-11-27', args)).toBeNull();
    expect(dueOnProblem('2026-10-27', args)).toMatch(/before today/);
    expect(dueOnProblem('2026-11-28', args)).toMatch(/at most 30 days, so it is due back by 2026-11-27/);
    expect(dueOnProblem('2026-11-28', { ...args, canExceedMax: true })).toBeNull();
    expect(dueOnProblem('2026-11-10', { ...args, projectNumber: 'AFRI-1325', projectEnd: '2026-11-05' }))
      .toBe("Project AFRI-1325 ends on 2026-11-05, so the tool is due back by then. Move the project's end date to lend it for longer.");
    // An administrator is held to the project too.
    expect(dueOnProblem('2026-11-10', { ...args, projectEnd: '2026-11-05', canExceedMax: true })).toMatch(/^The project ends on/);
    // A project that has already ended allows today and no later.
    expect(dueOnProblem('2026-10-28', { ...args, projectEnd: '2026-10-01' })).toBeNull();
    expect(dueOnProblem('2026-10-29', { ...args, projectEnd: '2026-10-01' })).toMatch(/ends on 2026-10-01/);
  });

  it('is due on its most recent change, else its own date, else the loan period after it went out', () => {
    const out = new Date('2026-10-28T08:00:00Z');
    const at = (iso: string) => new Date(iso);
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    // Made later, then pulled earlier: the most recent change wins, not the latest date.
    const dates = loanDatesOf({ postedAt: out, dueOn: day('2026-11-02') }, [
      { id: 'c-2', createdAt: at('2026-11-03T09:00:00Z'), dueOn: day('2026-11-06') },
      { id: 'c-1', createdAt: at('2026-11-01T09:00:00Z'), dueOn: day('2026-12-16') },
    ], terms);
    expect(dates.changes.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    expect(currentDueOn(dates)).toBe('2026-11-06');
    expect(dueOnAt(dates, at('2026-10-30T12:00:00Z'))).toBe('2026-11-02');
    expect(dueOnAt(dates, at('2026-11-02T12:00:00Z'))).toBe('2026-12-16');
    expect(dueOnAt(dates, at('2026-11-03T09:00:00Z'))).toBe('2026-11-06');
    expect(dueOnBefore(dates, 'c-1')).toBe('2026-11-02');
    expect(dueOnBefore(dates, 'c-2')).toBe('2026-12-16');

    expect(currentDueOn(loanDatesOf({ postedAt: out, dueOn: day('2026-11-02') }, [], terms))).toBe('2026-11-02');
    // A loan from before due dates: the loan period after it went out.
    expect(currentDueOn(loanDatesOf({ postedAt: out, dueOn: null }, [], terms))).toBe('2026-11-04');
  });

  it('is on loan, then due soon the day before and on the day, then overdue, then needs a decision', () => {
    const on = (today: string) => loanState('2026-11-04', today, terms);
    expect(on('2026-11-02')).toEqual({ state: 'ON_LOAN', daysLate: -2 });
    expect(on('2026-11-03')).toEqual({ state: 'DUE_SOON', daysLate: -1 });
    expect(on('2026-11-04')).toEqual({ state: 'DUE_SOON', daysLate: 0 });
    expect(on('2026-11-05')).toEqual({ state: 'OVERDUE', daysLate: 1 });
    expect(on('2026-11-17')).toEqual({ state: 'OVERDUE', daysLate: 13 });
    expect(on('2026-11-18')).toEqual({ state: 'NEEDS_DECISION', daysLate: 14 });
  });

  it('blocks lending to someone with an overdue tool only as the policy says', () => {
    expect(overdueBlocksCheckout(terms, 'CONTRACTOR')).toBe(false);
    expect(overdueBlocksCheckout({ ...terms, overdueCheckout: 'block-contractors' }, 'CONTRACTOR')).toBe(true);
    expect(overdueBlocksCheckout({ ...terms, overdueCheckout: 'block-contractors' }, 'WORKER')).toBe(false);
    expect(overdueBlocksCheckout({ ...terms, overdueCheckout: 'block' }, 'WORKER')).toBe(true);
  });
});
