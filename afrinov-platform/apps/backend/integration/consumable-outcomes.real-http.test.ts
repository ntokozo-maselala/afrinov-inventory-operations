// Real-HTTP + real-database tests for marking tracked consumables used up or
// broken (ADR-026): no stock moves, returns and outcomes share what is still
// out, a mistake is withdrawn rather than edited, an issue with outcomes is
// reversed only once they are withdrawn, and the Consumption report says who
// still has what. Return stock books all of it in one counter visit.
//
// Run with: npm run test:integration
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Use { issued: string; returned: string; usedUp: string; broken: string; stillOut: string }
interface IssueOutcomes extends Use {
  trackUse: boolean;
  outcomes: Array<{ id: string; outcome: string; quantity: string; note: string | null; withdrawn: { reason: string } | null }>;
}
interface HistoryRow { id: string; type: string; trackUse: boolean; usedUpQuantity: string | null; brokenQuantity: string | null }
interface Consumption {
  byRecipient: Array<{ recipientId: string | null; usedUp: number; broken: number; stillOut: number }>;
  lines?: Array<{ id: string; usedUp: number | null; broken: number | null; stillOut: number | null }>;
}

describe('consumable outcomes over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let discId: string;
  let gloveId: string;
  let rackId: string;
  let recipientId: string;
  let issueId: string;
  let gloveIssueId: string;

  async function onHand(): Promise<string> {
    const { ledger, balance } = await ledgerAndBalance(discId, rackId);
    expect(balance).toBe(ledger);
    return ledger;
  }

  const outcomesOf = async (id: string) => (await api<IssueOutcomes>('GET', `/inventory-transactions/${id}/outcomes`)).body;
  const mark = (id: string, body: unknown, key = randomUUID()) =>
    api<Use & { outcomeId: string; error?: { code: string; message: string } }>('POST', `/inventory-transactions/${id}/outcomes`, body, { 'Idempotency-Key': key });

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));

    const disc = await api<{ id: string; trackUse: boolean }>('POST', '/materials', {
      sku: `IT-DISC-${run}`, name: `Cutting disc 230mm ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 40, trackUse: true,
    });
    expect(disc.status).toBe(200);
    expect(disc.body.trackUse).toBe(true);
    discId = disc.body.id;
    const glove = await api<{ id: string }>('POST', '/materials', { sku: `IT-GLOVE-${run}`, name: `Gloves ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'pair' });
    gloveId = glove.body.id;
    const rack = await api<{ id: string }>('POST', '/locations', { name: `IT outcome rack ${run}`, type: 'RACK' });
    rackId = rack.body.id;
    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `IT boilermaker ${run}`, type: 'WORKER' });
    recipientId = recipient.body.id;
    for (const materialId of [discId, gloveId]) {
      expect((await api('POST', '/inventory-adjustments', { materialId, locationId: rackId, quantity: 20, reasonCode: 'COUNT_VARIANCE' })).status).toBe(201);
    }
    const issued = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', {
      recipientId, lines: [{ materialId: discId, locationId: rackId, quantity: 10 }, { materialId: gloveId, locationId: rackId, quantity: 2 }],
    });
    expect(issued.status).toBe(201);
    [issueId, gloveIssueId] = issued.body.transactionIds as [string, string];
  });

  afterAll(async () => {
    await server?.close();
  });

  it('marks part of an issue used up or broken without moving stock', async () => {
    expect(await onHand()).toBe('10');
    const key = randomUUID();
    const used = await mark(issueId, { outcome: 'USED_UP', quantity: 4, note: 'Stubs handed in' }, key);
    expect(used.status).toBe(201);
    expect(used.body).toMatchObject({ issued: '10', returned: '0', usedUp: '4', broken: '0', stillOut: '6' });
    // A retry with the same key replays the first answer instead of marking four more.
    const retry = await mark(issueId, { outcome: 'USED_UP', quantity: 4, note: 'Stubs handed in' }, key);
    expect(retry.status).toBe(201);
    expect(retry.body.outcomeId).toBe(used.body.outcomeId);

    expect((await mark(issueId, { outcome: 'BROKEN', quantity: 1 })).status).toBe(201);
    expect(await onHand()).toBe('10');

    const detail = await outcomesOf(issueId);
    expect(detail).toMatchObject({ trackUse: true, usedUp: '4', broken: '1', stillOut: '5' });
    expect(detail.outcomes.map((o) => [o.outcome, o.quantity, o.note])).toEqual([['USED_UP', '4', 'Stubs handed in'], ['BROKEN', '1', null]]);

    const history = await api<HistoryRow[]>('GET', `/inventory-transactions?materialId=${discId}&type=ISSUE`);
    expect(history.body[0]).toMatchObject({ id: issueId, trackUse: true, usedUpQuantity: '4', brokenQuantity: '1' });
  });

  it('shares what is still out with returns', async () => {
    const tooMany = await mark(issueId, { outcome: 'USED_UP', quantity: 6 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error?.message).toMatch(/only 5 of the 10 issued is still out/);

    expect((await api('POST', `/inventory-transactions/${issueId}/returns`, { quantity: 6 })).status).toBe(400);
    const back = await api<{ returnableQuantity: string }>('POST', `/inventory-transactions/${issueId}/returns`, { quantity: 2 });
    expect(back.status).toBe(201);
    expect(back.body.returnableQuantity).toBe('3');
    expect(await onHand()).toBe('12');

    const returnable = await api<Array<{ issueTransactionId: string; closedOff: string; outstanding: string }>>('GET', `/inventory-returns/returnable?recipientId=${recipientId}`);
    expect(returnable.body.find((l) => l.issueTransactionId === issueId)).toMatchObject({ closedOff: '5', outstanding: '3' });
  });

  it('says on the Consumption report who still has what', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await api<Consumption>('GET', `/reports/consumption?from=${today}&to=${today}&recipientId=${recipientId}`);
    expect(res.status).toBe(200);
    expect(res.body.byRecipient[0]).toMatchObject({ recipientId, usedUp: 4, broken: 1, stillOut: 3 });
    expect(res.body.lines?.find((l) => l.id === issueId)).toMatchObject({ usedUp: 4, broken: 1, stillOut: 3 });
    // Gloves do not track use, so nothing is said about them.
    expect(res.body.lines?.find((l) => l.id === gloveIssueId)).toMatchObject({ usedUp: null, broken: null, stillOut: null });
  });

  it('refuses an item that does not track use, and a tool that would', async () => {
    const untracked = await mark(gloveIssueId, { outcome: 'USED_UP', quantity: 1 });
    expect(untracked.status).toBe(409);
    expect(untracked.body.error?.code).toBe('INVALID_STATE');
    const tool = await api('POST', '/materials', { sku: `IT-DRILL-${run}`, name: `Drill ${run}`, category: 'TOOLS', unitOfMeasure: 'each', trackUse: true });
    expect(tool.status).toBe(400);
  });

  it('withdraws a mistake, and reverses the issue only once its outcomes are withdrawn', async () => {
    const blocked = await api<{ error: { message: string } }>('POST', `/inventory-transactions/${issueId}/reversal`, { reason: 'Wrong worker' });
    expect(blocked.status).toBe(409);

    // Returns are reversed first, as before.
    const returns = await api<Array<{ id: string }>>('GET', `/inventory-transactions?materialId=${discId}&type=RETURN`);
    expect((await api('POST', `/inventory-transactions/${returns.body[0]!.id}/reversal`, { reason: 'Booked to the wrong worker' })).status).toBe(201);
    const stillBlocked = await api<{ error: { message: string } }>('POST', `/inventory-transactions/${issueId}/reversal`, { reason: 'Wrong worker' });
    expect(stillBlocked.status).toBe(409);
    expect(stillBlocked.body.error.message).toMatch(/Withdraw those first/);

    for (const o of (await outcomesOf(issueId)).outcomes) {
      const w = await api<Use>('POST', `/consumable-outcomes/${o.id}/withdrawal`, { reason: 'Booked to the wrong worker' }, { 'Idempotency-Key': randomUUID() });
      expect(w.status).toBe(201);
    }
    const again = await api('POST', `/consumable-outcomes/${(await outcomesOf(issueId)).outcomes[0]!.id}/withdrawal`, { reason: 'Twice' });
    expect(again.status).toBe(409);

    const detail = await outcomesOf(issueId);
    expect(detail).toMatchObject({ usedUp: '0', broken: '0', stillOut: '10' });
    expect(detail.outcomes.every((o) => o.withdrawn?.reason === 'Booked to the wrong worker')).toBe(true);
    // Nothing is deleted: two outcomes and two withdrawals.
    expect(await prisma.consumableOutcome.count({ where: { issueTransactionId: issueId } })).toBe(4);

    expect((await api('POST', `/inventory-transactions/${issueId}/reversal`, { reason: 'Wrong worker' })).status).toBe(201);
    expect(await onHand()).toBe('20');
    expect((await mark(issueId, { outcome: 'USED_UP', quantity: 1 })).status).toBe(409);
  });

  it('books a counter visit on Return stock: back on the shelf, used up and broken, all or nothing', async () => {
    const issued = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', {
      recipientId, lines: [{ materialId: discId, locationId: rackId, quantity: 10 }, { materialId: gloveId, locationId: rackId, quantity: 2 }],
    });
    const [disc, glove] = issued.body.transactionIds as [string, string];
    expect(await onHand()).toBe('10');
    const listed = await api<Array<{ issueTransactionId: string; trackUse: boolean }>>('GET', `/inventory-returns/returnable?recipientId=${recipientId}`);
    expect(listed.body.find((l) => l.issueTransactionId === disc)?.trackUse).toBe(true);
    expect(listed.body.find((l) => l.issueTransactionId === glove)?.trackUse).toBe(false);

    const visit = (lines: unknown[], key = randomUUID()) =>
      api<{ transactionIds: string[]; outcomeIds: string[]; error?: { code: string; message: string } }>('POST', '/inventory-returns', { reason: 'Disc shattered on the grinder', lines }, { 'Idempotency-Key': key });

    // Used up on gloves, which do not track use, refuses the whole visit: nothing is booked.
    const refused = await visit([{ issueTransactionId: disc, quantity: 2, usedUp: 6 }, { issueTransactionId: glove, usedUp: 1 }]);
    expect(refused.status).toBe(409);
    expect(refused.body.error?.message).toMatch(/does not track use after issue/);
    expect(await onHand()).toBe('10');
    expect((await outcomesOf(disc)).stillOut).toBe('10');
    // The three together are checked against what is still out.
    const over = await visit([{ issueTransactionId: disc, quantity: 4, usedUp: 6, broken: 1 }]);
    expect(over.status).toBe(400);
    expect(over.body.error?.message).toMatch(/Cannot take back 11 × .*only 10 of the 10 issued is still out/);
    expect((await visit([{ issueTransactionId: disc }])).status).toBe(400);

    const key = randomUUID();
    const booked = await visit([{ issueTransactionId: disc, quantity: 2, usedUp: 6, broken: 1 }, { issueTransactionId: glove, quantity: 1 }], key);
    expect(booked.status).toBe(201);
    expect(booked.body.transactionIds).toHaveLength(2);
    expect(booked.body.outcomeIds).toHaveLength(2);
    // A retry with the same key replays the visit instead of booking it twice.
    const retry = await visit([{ issueTransactionId: disc, quantity: 2, usedUp: 6, broken: 1 }, { issueTransactionId: glove, quantity: 1 }], key);
    expect(retry.body.outcomeIds).toEqual(booked.body.outcomeIds);

    // Only the two back on the shelf moved stock.
    expect(await onHand()).toBe('12');
    const detail = await outcomesOf(disc);
    expect(detail).toMatchObject({ returned: '2', usedUp: '6', broken: '1', stillOut: '1' });
    expect(detail.outcomes.map((o) => [o.outcome, o.quantity, o.note])).toEqual([
      ['USED_UP', '6', 'Disc shattered on the grinder'], ['BROKEN', '1', 'Disc shattered on the grinder'],
    ]);
    const audits = await prisma.auditLogEntry.count({ where: { entityId: disc, action: { in: ['RETURN', 'CONSUMABLE_OUTCOME'] } } });
    expect(audits).toBe(3);
  });

  it('records every counter visit and every withdrawal on Movements, so nothing is missing from the history', async () => {
    const issued = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', {
      recipientId, lines: [{ materialId: discId, locationId: rackId, quantity: 5 }],
    });
    const [disc] = issued.body.transactionIds as [string];
    const visit = (lines: unknown[]) =>
      api<{ transactionIds: string[]; outcomeIds: string[] }>('POST', '/inventory-returns', { lines }, { 'Idempotency-Key': randomUUID() });

    // One visit with some back on the shelf, one with only stubs.
    const first = await visit([{ issueTransactionId: disc, quantity: 2, usedUp: 1 }]);
    expect(first.status).toBe(201);
    const second = await visit([{ issueTransactionId: disc, usedUp: 1, broken: 1 }]);
    expect(second.status).toBe(201);
    const [usedId, brokenId] = second.body.outcomeIds as [string, string];
    // The broken one was a mistake.
    expect((await api('POST', `/consumable-outcomes/${brokenId}/withdrawal`, { reason: 'Belonged to another worker' }, { 'Idempotency-Key': randomUUID() })).status).toBe(201);

    interface Row { id: string; type: string; quantity: string | null; usedUpQuantity: string | null; brokenQuantity: string | null; reasonNote: string | null; referenceId: string | null }
    const rows = (await api<Row[]>('GET', `/inventory-transactions?materialId=${discId}&limit=50`)).body;
    const ret = rows.find((r) => r.id === first.body.transactionIds[0]);
    // The return's row shows the stub booked with it.
    expect(ret).toMatchObject({ type: 'RETURN', quantity: '2', usedUpQuantity: '1', brokenQuantity: '0' });
    // The visit with nothing back on the shelf is on its own rows, with no stock quantity.
    expect(rows.find((r) => r.id === usedId)).toMatchObject({ type: 'USED_UP', quantity: null, usedUpQuantity: '1', referenceId: disc });
    expect(rows.find((r) => r.id === brokenId)).toMatchObject({ type: 'BROKEN', quantity: null, brokenQuantity: '1' });
    // The withdrawal is a row too, with its reason.
    expect(rows.find((r) => r.type === 'OUTCOME_WITHDRAWN' && r.referenceId === disc)).toMatchObject({ quantity: null, brokenQuantity: '1', reasonNote: 'Belonged to another worker' });
    // The mark booked with the return is not listed twice.
    expect(rows.filter((r) => r.type === 'USED_UP' && r.referenceId === disc)).toHaveLength(1);

    // The returned stock report has them too; the issued report does not.
    const returned = (await api<Row[]>('GET', `/inventory-transactions?materialId=${discId}&report=returned&limit=50`)).body;
    expect(returned.map((r) => r.type)).toEqual(expect.arrayContaining(['RETURN', 'USED_UP', 'BROKEN', 'OUTCOME_WITHDRAWN']));
    const issuedReport = (await api<Row[]>('GET', `/inventory-transactions?materialId=${discId}&report=issued&limit=50`)).body;
    expect(issuedReport.every((r) => r.type === 'ISSUE')).toBe(true);
    const summary = (await api<{ byType: Record<string, number> }>('GET', `/inventory-transactions/summary?materialId=${discId}`)).body;
    expect(summary.byType).toMatchObject({ USED_UP: expect.any(Number), BROKEN: expect.any(Number), OUTCOME_WITHDRAWN: expect.any(Number) });
  });
});
