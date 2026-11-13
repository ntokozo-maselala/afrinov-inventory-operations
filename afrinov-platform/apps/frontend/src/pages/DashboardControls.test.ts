// The Dashboard's control notices (system audit C9, F5).
import { describe, it, expect } from 'vitest';
import { checksOffCard, selfIssuedCard } from './Dashboard';

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
