// The Dashboard's control notices (system audit C9, F5).
import { describe, it, expect } from 'vitest';
import { checksOffCard, issuesWaitingCard, selfIssuedCard, writeOffsWaitingCard } from './Dashboard';
import { describeReceipt } from '../lib/receipts';

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

// ADR-043: material stays in the store until the Workshop Manager approves, so two days is already long.
describe('issuesWaitingCard (ADR-043)', () => {
  it('counts the project issues waiting, warning from two days', () => {
    expect(issuesWaitingCard({ waiting: 0, oldestDays: null })).toBeNull();
    expect(issuesWaitingCard({ waiting: 1, oldestDays: 0 })).toMatchObject({ label: 'Issues to approve', value: '1', tone: 'neutral', note: 'oldest asked for today', to: '/stock/issue-approvals' });
    expect(issuesWaitingCard({ waiting: 4, oldestDays: 2 })).toMatchObject({ tone: 'warning', note: 'oldest waiting 2 days' });
  });

  it('says a project slip was approved, not signed for', () => {
    const r = { method: 'APPROVAL' as const, signerId: null, signerName: null, collectedFor: false, reason: null, note: null, confirmedAt: '2026-11-16T10:00:00.000Z', capturedByName: 'Workshop Manager', hasImage: false, imageRemoved: false, changed: false };
    expect(describeReceipt(r, 'Bongani')).toMatchObject({ badge: 'Approved', tone: 'success', text: expect.stringMatching(/^Approved by Workshop Manager before it was issued/) });
    expect(describeReceipt({ ...r, changed: true }, 'Bongani')).toMatchObject({ badge: 'Changed after it was approved', tone: 'danger' });
  });
});

describe('writeOffsWaitingCard (system audit C8)', () => {
  it('counts what waits and says how old the oldest is, warning after a week', () => {
    expect(writeOffsWaitingCard({ waiting: 0, oldestDays: null })).toBeNull();
    expect(writeOffsWaitingCard({ waiting: 2, oldestDays: 0 })).toMatchObject({ value: '2', tone: 'neutral', note: 'oldest asked for today', to: '/stock/write-offs' });
    expect(writeOffsWaitingCard({ waiting: 3, oldestDays: 9 })).toMatchObject({ tone: 'warning', note: 'oldest waiting 9 days' });
  });
});
