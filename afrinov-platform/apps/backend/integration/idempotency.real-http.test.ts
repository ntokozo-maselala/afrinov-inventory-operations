// Real-HTTP + real-database tests for idempotency on inventory mutations
// (TD-019, API principle 3). A retried issue with the same `Idempotency-Key`
// must not post the movement twice; the ledger, the balance and the response
// must be identical on the replay.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ADMIN_EMAIL,
  client,
  ledgerAndBalance,
  login,
  requireAdminPassword,
  runId,
  startServer,
  type TestServer,
} from './helpers.js';

interface IssueResult {
  transactionIds: string[];
}

describe('idempotent inventory mutations over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let locationId: string;
  let recipientId: string;

  function issueBody(quantity: number) {
    return { recipientId, lines: [{ materialId, locationId, quantity }] };
  }

  async function ledgerAt(): Promise<string> {
    const { ledger, balance } = await ledgerAndBalance(materialId, locationId);
    expect(balance).toBe(ledger);
    return ledger;
  }

  beforeAll(async () => {
    const password = requireAdminPassword();
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, password));

    const material = await api<{ id: string }>('POST', '/materials', {
      sku: `IDEM-${run}`,
      name: `Idempotency bolt ${run}`,
      category: 'CONSUMABLES',
      unitOfMeasure: 'each',
      requiredStock: 0,
    });
    materialId = material.body.id;

    const location = await api<{ id: string }>('POST', '/locations', {
      name: `Idempotency store ${run}`,
      type: 'STOREROOM',
    });
    locationId = location.body.id;

    // Seed stock so the issues below have something to draw on.
    const receipt = await api('POST', '/inventory-adjustments', {
      materialId,
      locationId,
      quantity: 100,
      reasonCode: 'OTHER',
    });
    expect(receipt.status).toBe(201);

    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `Idempotency recipient ${run}`, type: 'WORKER' });
    recipientId = recipient.body.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('replays the first response instead of posting the issue twice', async () => {
    const key = `idem-issue-${run}-a`;
    const before = await ledgerAt();

    const first = await api<IssueResult>('POST', '/inventory-issues', issueBody(3), { 'idempotency-key': key });
    expect(first.status).toBe(201);
    expect(first.body.transactionIds).toHaveLength(1);
    expect(first.headers.get('idempotency-replayed')).toBeNull();
    expect(await ledgerAt()).toBe((Number(before) - 3).toString());

    const retry = await api<IssueResult>('POST', '/inventory-issues', issueBody(3), { 'idempotency-key': key });
    expect(retry.status).toBe(201);
    // The same movement id is replayed, and the ledger did not move again.
    expect(retry.body).toEqual(first.body);
    expect(retry.headers.get('idempotency-replayed')).toBe('true');
    expect(await ledgerAt()).toBe((Number(before) - 3).toString());
  });

  it('still posts two separate movements when no key is sent', async () => {
    const before = await ledgerAt();
    await api('POST', '/inventory-issues', issueBody(2));
    await api('POST', '/inventory-issues', issueBody(2));
    expect(await ledgerAt()).toBe((Number(before) - 4).toString());
  });

  it('refuses a key reused with a different body', async () => {
    const key = `idem-issue-${run}-b`;
    const before = await ledgerAt();
    await api('POST', '/inventory-issues', issueBody(5), { 'idempotency-key': key });
    expect(await ledgerAt()).toBe((Number(before) - 5).toString());

    const conflicting = await api<{ error: { code: string } }>('POST', '/inventory-issues', issueBody(6), { 'idempotency-key': key });
    expect(conflicting.status).toBe(409);
    // A distinct code so the client can rotate its key rather than retry forever.
    expect(conflicting.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // The conflicting retry posted nothing.
    expect(await ledgerAt()).toBe((Number(before) - 5).toString());
  });

  it('scopes a key to the record in the path, not just the body', async () => {
    // Two movements of the same size, reversed with the same reason and the same
    // key. The path (which holds the transaction id) is what tells them apart:
    // without the scope the second would replay the first instead of reversing.
    const issued = await api<IssueResult>('POST', '/inventory-issues', issueBody(2));
    expect(issued.status).toBe(201);
    const txA = issued.body.transactionIds[0]!;

    const issued2 = await api<IssueResult>('POST', '/inventory-issues', issueBody(2));
    expect(issued2.status).toBe(201);
    const txB = issued2.body.transactionIds[0]!;

    const key = `idem-reverse-${run}-a`;
    const first = await api('POST', `/inventory-transactions/${txA}/reversal`, { reason: 'Wrong item issued' }, { 'idempotency-key': key });
    expect(first.status).toBe(201);

    const second = await api<{ error: { code: string } }>(
      'POST',
      `/inventory-transactions/${txB}/reversal`,
      { reason: 'Wrong item issued' },
      { 'idempotency-key': key },
    );
    // A different record under the same key is a conflict, not a replay.
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('replays a rejected issue without re-checking the balance', async () => {
    const key = `idem-issue-${run}-c`;
    // Far more than the balance: refused, and nothing is stored under the key.
    const refused = await api('POST', '/inventory-issues', issueBody(100_000), { 'idempotency-key': key });
    expect(refused.status).toBe(422);
    const before = await ledgerAt();

    // A second attempt with the same key runs again (the failure was not
    // recorded) and is refused again, still changing nothing.
    const refusedAgain = await api('POST', '/inventory-issues', issueBody(100_000), { 'idempotency-key': key });
    expect(refusedAgain.status).toBe(422);
    expect(await ledgerAt()).toBe(before);
  });

  it('refuses a present but invalid key rather than running unkeyed', async () => {
    const before = await ledgerAt();
    const blank = await api<{ error: { code: string } }>('POST', '/inventory-issues', issueBody(1), { 'idempotency-key': '   ' });
    expect(blank.status).toBe(400);
    expect(blank.body.error.code).toBe('VALIDATION_ERROR');

    const tooLong = await api<{ error: { code: string } }>('POST', '/inventory-issues', issueBody(1), { 'idempotency-key': 'a'.repeat(201) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');

    // Neither attempt posted anything.
    expect(await ledgerAt()).toBe(before);
  });

  it('replays for a concurrent retry with the same key instead of failing it', async () => {
    const key = `idem-issue-${run}-race`;
    const before = await ledgerAt();
    // Fire the same keyed request several times at once. Exactly one runs the
    // operation; the rest must replay its response, not fail a balance check.
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => api<IssueResult>('POST', '/inventory-issues', issueBody(3), { 'idempotency-key': key })),
    );
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.transactionIds).toHaveLength(1);
    }
    // All four agree on the same single movement id.
    const ids = new Set(responses.map((r) => r.body.transactionIds[0]));
    expect(ids.size).toBe(1);
    // The ledger moved once, not four times.
    expect(await ledgerAt()).toBe((Number(before) - 3).toString());
  });
});
