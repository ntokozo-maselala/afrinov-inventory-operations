// The Dashboard's control notices (system audit C9, F5).
import { describe, it, expect } from 'vitest';
import { checksOffCard, selfIssuedCard, writeOffsWaitingCard } from './Dashboard';

describe('checksOffCard', () => {
  it('shows only while a two-person check is off', () => {
    expect(checksOffCard({ 'inventory.requireWriteOffApproval': true, 'purchaseOrders.requireApprovalBeforeProcessing': true }, true)).toBeNull();
    expect(checksOffCard(null, true)).toBeNull();
    expect(checksOffCard({ 'inventory.requireWriteOffApproval': false, 'purchaseOrders.requireApprovalBeforeProcessing': false }, true))
      .toMatchObject({ value: 'Off', note: 'write-off approval and order approval switched off', to: '/settings/inventory' });
    // Order approval counts only while purchase orders are switched on.
    expect(checksOffCard({ 'inventory.requireWriteOffApproval': true, 'purchaseOrders.requireApprovalBeforeProcessing': false }, false)).toBeNull();
  });
});

describe('selfIssuedCard', () => {
  it('counts the slips and names who issued them', () => {
    expect(selfIssuedCard({ days: 30, slips: [] })).toBeNull();
    const slip = (name: string, at: string) => ({ issueId: at, kind: 'ISSUE' as const, postedAt: at, by: { id: name, name } });
    expect(selfIssuedCard({ days: 30, slips: [slip('Thabo', '2026-11-10T08:00:00Z'), slip('Thabo', '2026-11-02T08:00:00Z'), slip('Lerato', '2026-10-20T08:00:00Z')] }))
      .toMatchObject({ value: '3', note: 'Thabo, Lerato · last 30 days', to: '/movements?report=issued&from=2026-10-20' });
  });
});

describe('writeOffsWaitingCard (system audit C8)', () => {
  it('counts what waits and says how old the oldest is, warning after a week', () => {
    expect(writeOffsWaitingCard({ waiting: 0, oldestDays: null })).toBeNull();
    expect(writeOffsWaitingCard({ waiting: 2, oldestDays: 0 })).toMatchObject({ value: '2', tone: 'neutral', note: 'oldest asked for today', to: '/stock/write-offs' });
    expect(writeOffsWaitingCard({ waiting: 3, oldestDays: 9 })).toMatchObject({ tone: 'warning', note: 'oldest waiting 9 days' });
  });
});
