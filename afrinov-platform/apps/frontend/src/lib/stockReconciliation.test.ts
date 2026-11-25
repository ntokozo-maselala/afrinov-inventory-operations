// What Admins are told about the daily stock check (ADR-047).
import { describe, it, expect } from 'vitest';
import { reconciliationCard, reconciliationNotice, type ReconciliationHealth } from './stockReconciliation';
import { formatNumber } from './format';

const at = '2026-11-23T02:00:03Z';
const health = (state: ReconciliationHealth['state'], over: Partial<NonNullable<ReconciliationHealth['lastRun']>> = {}): ReconciliationHealth => ({
  state,
  lastRun: state === 'NONE' ? null : {
    status: state === 'DRIFT' ? 'DRIFT' : state === 'FAILED' ? 'FAILED' : 'OK',
    startedAt: at, finishedAt: at, balances: 1138, issues: 40, problemCount: 0, problems: [], detail: null, ...over,
  },
});

describe('reconciliationNotice', () => {
  it('says all is well after a clean check, with its counts', () => {
    const n = reconciliationNotice(health('OK'));
    expect(n.tone).toBe('success');
    expect(n.text).toContain(`${formatNumber(1138)} balances`);
  });

  it('says how many figures do not add up, as danger', () => {
    const n = reconciliationNotice(health('DRIFT', { problemCount: 2, problems: ['a', 'b'] }));
    expect(n).toMatchObject({ tone: 'danger', title: '2 stock figures don\'t add up' });
    expect(n.text).toMatch(/defect/);
  });

  it('uses the singular for one', () => {
    expect(reconciliationNotice(health('DRIFT', { problemCount: 1, problems: ['a'] })).title).toBe('1 stock figure doesn\'t add up');
  });

  it('tells a check that could not run apart from drift, with its reason', () => {
    const n = reconciliationNotice(health('FAILED', { detail: 'The check could not finish, so the figures were not checked.' }));
    expect(n.tone).toBe('danger');
    expect(n.title).toBe('The stock check could not run');
    expect(n.text).toMatch(/could not finish/);
  });

  it('warns when the check has stopped or never ran', () => {
    expect(reconciliationNotice(health('LATE')).tone).toBe('warning');
    expect(reconciliationNotice(health('NONE'))).toMatchObject({ tone: 'warning', title: 'No stock check yet' });
  });
});

describe('reconciliationCard', () => {
  it('shows nothing on the Dashboard when the figures add up', () => {
    expect(reconciliationCard(health('OK'))).toBeNull();
  });

  it('shows drift as a danger card that leads to the details', () => {
    expect(reconciliationCard(health('DRIFT', { problemCount: 3, problems: ['a', 'b', 'c'] }))).toEqual({
      label: 'Stock check', value: '3 wrong', tone: 'danger', note: '3 stock figures don\'t add up', to: '/settings/data',
    });
  });

  it('shows a failed, late or missing check as a warning or danger card', () => {
    expect(reconciliationCard(health('FAILED'))).toMatchObject({ value: 'Failed', tone: 'danger' });
    expect(reconciliationCard(health('LATE'))).toMatchObject({ value: 'Late', tone: 'warning' });
    expect(reconciliationCard(health('NONE'))).toMatchObject({ value: 'Not run', tone: 'warning' });
  });

  it('shows nothing for a response it does not understand', () => {
    expect(reconciliationCard(null)).toBeNull();
    expect(reconciliationCard({} as ReconciliationHealth)).toBeNull();
  });
});
