// Real-HTTP + real-database check that the numbers agree after every
// operation on issued stock (ADR-026). After each step, for each issue:
//
//   issued = back on the shelf + used up + broken + still out, still out >= 0
//
// and the issue's figures, its Movements row, the rows of every counter visit
// and withdrawal in the history, the Return stock list, the Stock used report
// and the stock on hand all say the same thing. Stock on hand is the ledger's
// sum, and the history's quantities add up to it. The database check
// (npm run check:issued-stock) finds nothing wrong after any step, and does
// find a balance that is wrong.
//
// Run with: npm run test:integration
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';
import { checkIssuedStock } from '../src/modules/inventory/issued-stock-check.js';

interface Use { issued: string; returned: string; usedUp: string; broken: string; stillOut: string; trackUse: boolean; outcomes: Array<{ id: string; withdrawn: unknown }> }
interface Row {
  id: string; type: string; quantity: string | null; locationId: string; referenceId: string | null; reversesId: string | null; reversedById: string | null;
  returnedQuantity: string | null; usedUpQuantity: string | null; brokenQuantity: string | null;
}
interface Returnable { issueTransactionId: string; outstanding: string; closedOff: string; returned: string }
interface Consumption {
  items: Array<{ materialId: string; issued: number; returned: number; used: number }>;
  byRecipient: Array<{ recipientId: string | null; usedUp: number | null; broken: number | null; stillOut: number | null }>;
  lines?: Array<{ id: string; type: string; quantity: number; usedUp: number | null; broken: number | null; stillOut: number | null }>;
}

const num = (s: string | number | null | undefined) => Number(s ?? 0);

describe('the numbers agree after every operation on issued stock', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let discId: string;
  let gloveId: string;
  let rackA: string;
  let rackB: string;
  let workerId: string;
  /** Every issue made in this test, by item. */
  const issues: Array<{ id: string; materialId: string }> = [];
  const today = new Date().toISOString().slice(0, 10);
  const key = () => ({ 'Idempotency-Key': randomUUID() });

  /** Check every view against every other for each issue, and stock on hand. Returns each issue's figures. */
  async function reconcile(step: string): Promise<Map<string, Use>> {
    const figures = new Map<string, Use>();
    const history = new Map<string, Row[]>();
    for (const materialId of [discId, gloveId]) {
      history.set(materialId, (await api<Row[]>('GET', `/inventory-transactions?materialId=${materialId}&limit=1000`)).body);
    }
    const returnable = (await api<Returnable[]>('GET', `/inventory-returns/returnable?recipientId=${workerId}`)).body;
    const consumption = (await api<Consumption>('GET', `/reports/consumption?from=${today}&to=${today}&recipientId=${workerId}`)).body;

    for (const { id, materialId } of issues) {
      const u = (await api<Use>('GET', `/inventory-transactions/${id}/outcomes`)).body;
      figures.set(id, u);
      const rows = history.get(materialId)!;
      const issueRow = rows.find((r) => r.id === id)!;
      const reversed = !!issueRow.reversedById;
      const at = `${step}, issue ${id.slice(0, 8)}`;

      // 1. The equation, and nothing negative.
      expect(num(u.issued) - num(u.returned) - num(u.usedUp) - num(u.broken), `${at}: issued − back − used up − broken`).toBe(num(u.stillOut));
      expect(num(u.stillOut), `${at}: still out`).toBeGreaterThanOrEqual(0);

      // 2. The issue's Movements row says the same.
      expect({ returned: num(issueRow.returnedQuantity), usedUp: num(issueRow.usedUpQuantity), broken: num(issueRow.brokenQuantity) }, `${at}: issue row`)
        .toEqual({ returned: num(u.returned), usedUp: num(u.usedUp), broken: num(u.broken) });

      // 3. The history adds up to it: returns and their reversals; marks on
      //    return rows and on rows of their own, less withdrawals.
      const returns = rows.filter((r) => r.type === 'RETURN' && r.referenceId === id && !r.reversesId);
      const returnIds = new Set(returns.map((r) => r.id));
      const reversals = rows.filter((r) => r.type === 'RETURN' && r.reversesId && returnIds.has(r.reversesId));
      const backInHistory = [...returns, ...reversals].reduce((a, r) => a + num(r.quantity), 0);
      expect(backInHistory, `${at}: returns in the history`).toBe(num(u.returned));
      const marks = (field: 'usedUpQuantity' | 'brokenQuantity', type: 'USED_UP' | 'BROKEN') =>
        returns.reduce((a, r) => a + num(r[field]), 0)
        + rows.filter((r) => r.type === type && r.referenceId === id).reduce((a, r) => a + num(r[field]), 0)
        - rows.filter((r) => r.type === 'OUTCOME_WITHDRAWN' && r.referenceId === id).reduce((a, r) => a + num(r[field]), 0);
      expect(marks('usedUpQuantity', 'USED_UP'), `${at}: used up in the history`).toBe(num(u.usedUp));
      expect(marks('brokenQuantity', 'BROKEN'), `${at}: broken in the history`).toBe(num(u.broken));
      // Rows that record a mark move no stock.
      for (const r of rows.filter((x) => ['USED_UP', 'BROKEN', 'OUTCOME_WITHDRAWN'].includes(x.type))) expect(r.quantity, `${at}: mark row quantity`).toBeNull();

      // 4. Return stock lists what is still out, and nothing once none is.
      const line = returnable.find((l) => l.issueTransactionId === id);
      if (reversed || num(u.stillOut) === 0) expect(line, `${at}: returnable line`).toBeUndefined();
      else expect(line && { outstanding: num(line.outstanding), returned: num(line.returned), closedOff: num(line.closedOff) }, `${at}: returnable line`)
        .toEqual({ outstanding: num(u.stillOut), returned: num(u.returned), closedOff: num(u.usedUp) + num(u.broken) });

      // 5. Stock used, line by line, for an issue that counts.
      const cLine = consumption.lines?.find((l) => l.id === id);
      if (reversed) expect(cLine, `${at}: reversed issue on Stock used`).toBeUndefined();
      else {
        expect(cLine?.quantity, `${at}: Stock used issue line`).toBe(num(u.issued));
        const shows = u.trackUse || num(u.usedUp) + num(u.broken) > 0;
        expect(cLine && { usedUp: cLine.usedUp, broken: cLine.broken, stillOut: cLine.stillOut }, `${at}: Stock used figures`)
          .toEqual(shows ? { usedUp: num(u.usedUp), broken: num(u.broken), stillOut: num(u.stillOut) } : { usedUp: null, broken: null, stillOut: null });
      }
    }

    // 6. Stock used by item: issued less returned, over the issues that count.
    for (const materialId of [discId, gloveId]) {
      const counted = issues.filter((i) => i.materialId === materialId && !history.get(materialId)!.find((r) => r.id === i.id)!.reversedById);
      const issued = counted.reduce((a, i) => a + num(figures.get(i.id)!.issued), 0);
      const back = counted.reduce((a, i) => a + num(figures.get(i.id)!.returned), 0);
      const item = consumption.items.find((b) => b.materialId === materialId);
      if (issued === 0) expect(item?.used ?? 0, `${step}: Stock used for an item with nothing issued`).toBe(0);
      else expect(item && { issued: item.issued, returned: item.returned, used: item.used }, `${step}: Stock used by item`).toEqual({ issued, returned: back, used: issued - back });
    }

    // 7. Stock on hand: the stored balance is the ledger's sum, the stock
    //    report says it, and the history's quantities add up to it.
    for (const materialId of [discId, gloveId]) {
      for (const locationId of [rackA, rackB]) {
        const { ledger, balance } = await ledgerAndBalance(materialId, locationId);
        expect(num(balance), `${step}: stored balance`).toBe(num(ledger));
        const fromHistory = history.get(materialId)!.filter((r) => r.locationId === locationId && r.quantity !== null).reduce((a, r) => a + num(r.quantity), 0);
        expect(fromHistory, `${step}: history quantities at a location`).toBe(num(balance));
        const report = (await api<Array<{ locationId: string; quantity: string }>>('GET', `/reports/current-stock?materialId=${materialId}`)).body;
        expect(num(report.find((s) => s.locationId === locationId)?.quantity), `${step}: Stock report`).toBe(num(balance));
      }
    }

    // 8. The database check agrees: nothing in the whole database fails to add up.
    expect((await checkIssuedStock(prisma)).problems, `${step}: database check`).toEqual([]);
    return figures;
  }

  const onHand = async (materialId: string, locationId: string) => num((await ledgerAndBalance(materialId, locationId)).balance);

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    discId = (await api<{ id: string }>('POST', '/materials', { sku: `IT-MATH-DISC-${run}`, name: `Grinding disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 32, trackUse: true })).body.id;
    gloveId = (await api<{ id: string }>('POST', '/materials', { sku: `IT-MATH-GLOVE-${run}`, name: `Gloves ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'pair', unitCost: 50 })).body.id;
    rackA = (await api<{ id: string }>('POST', '/locations', { name: `IT math rack A ${run}`, type: 'RACK' })).body.id;
    rackB = (await api<{ id: string }>('POST', '/locations', { name: `IT math rack B ${run}`, type: 'RACK' })).body.id;
    workerId = (await api<{ id: string }>('POST', '/recipients', { name: `IT math worker ${run}`, type: 'WORKER' })).body.id;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('agrees at every step from stock in to the issue reversed', async () => {
    // Stock in.
    for (const materialId of [discId, gloveId]) {
      expect((await api('POST', '/inventory-adjustments', { materialId, locationId: rackA, quantity: 20, reasonCode: 'COUNT_VARIANCE' })).status).toBe(201);
    }
    await reconcile('stock in');

    // Issue 10 discs and 4 pairs of gloves.
    const issued = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', {
      recipientId: workerId, lines: [{ materialId: discId, locationId: rackA, quantity: 10 }, { materialId: gloveId, locationId: rackA, quantity: 4 }],
    }, key());
    expect(issued.status).toBe(201);
    const [disc, glove] = issued.body.transactionIds as [string, string];
    issues.push({ id: disc, materialId: discId }, { id: glove, materialId: gloveId });
    let f = await reconcile('issue');
    expect(f.get(disc)!.stillOut).toBe('10');
    expect(await onHand(discId, rackA)).toBe(10);

    // A counter visit: 2 back on the shelf, 3 used up, 1 broken; 1 pair of gloves back.
    const visit1 = await api<{ transactionIds: string[]; outcomeIds: string[] }>('POST', '/inventory-returns', {
      reason: 'Morning shift', lines: [{ issueTransactionId: disc, quantity: 2, usedUp: 3, broken: 1 }, { issueTransactionId: glove, quantity: 1 }],
    }, key());
    expect(visit1.status).toBe(201);
    f = await reconcile('visit with all three');
    expect(f.get(disc)).toMatchObject({ returned: '2', usedUp: '3', broken: '1', stillOut: '4' });
    expect(await onHand(discId, rackA)).toBe(12);

    // A visit with only stubs: no stock moves.
    expect((await api('POST', '/inventory-returns', { lines: [{ issueTransactionId: disc, usedUp: 1 }] }, key())).status).toBe(201);
    f = await reconcile('visit with only stubs');
    expect(f.get(disc)!.stillOut).toBe('3');
    expect(await onHand(discId, rackA)).toBe(12);

    // One mark through the per-issue route, then withdrawn.
    const single = await api<{ outcomeId: string }>('POST', `/inventory-transactions/${disc}/outcomes`, { outcome: 'BROKEN', quantity: 1 }, key());
    expect(single.status).toBe(201);
    f = await reconcile('single mark');
    expect(f.get(disc)!.stillOut).toBe('2');
    expect((await api('POST', `/consumable-outcomes/${single.body.outcomeId}/withdrawal`, { reason: 'Booked twice' }, key())).status).toBe(201);
    f = await reconcile('single mark withdrawn');
    expect(f.get(disc)!.stillOut).toBe('3');

    // A return into another rack, then reversed.
    const intoB = await api<{ transactionIds: string[] }>('POST', '/inventory-returns', { lines: [{ issueTransactionId: disc, quantity: 1, locationId: rackB }] }, key());
    expect(intoB.status).toBe(201);
    f = await reconcile('return into another rack');
    expect(await onHand(discId, rackB)).toBe(1);
    expect((await api('POST', `/inventory-transactions/${intoB.body.transactionIds[0]}/reversal`, { reason: 'Wrong rack' }, key())).status).toBe(201);
    f = await reconcile('that return reversed');
    expect(f.get(disc)!.stillOut).toBe('3');
    expect(await onHand(discId, rackB)).toBe(0);

    // A retried booking replays instead of counting twice.
    const retryKey = key();
    const once = await api<{ outcomeIds: string[] }>('POST', '/inventory-returns', { lines: [{ issueTransactionId: disc, usedUp: 1 }] }, retryKey);
    const again = await api<{ outcomeIds: string[] }>('POST', '/inventory-returns', { lines: [{ issueTransactionId: disc, usedUp: 1 }] }, retryKey);
    expect(again.body.outcomeIds).toEqual(once.body.outcomeIds);
    f = await reconcile('retried booking');
    expect(f.get(disc)!.stillOut).toBe('2');

    // More than is still out is refused, and changes nothing.
    expect((await api('POST', '/inventory-returns', { lines: [{ issueTransactionId: disc, quantity: 1, usedUp: 2 }] }, key())).status).toBe(400);
    f = await reconcile('refused booking');
    expect(f.get(disc)!.stillOut).toBe('2');

    // Switching tracking off: earlier marks still count, and still show.
    expect((await api('PATCH', `/materials/${discId}`, { trackUse: false })).status).toBe(200);
    f = await reconcile('tracking switched off');
    expect(f.get(disc)).toMatchObject({ usedUp: '5', broken: '1', stillOut: '2', trackUse: false });
    expect((await api('POST', '/inventory-returns', { lines: [{ issueTransactionId: disc, usedUp: 1 }] }, key())).status).toBe(409);
    expect((await api('PATCH', `/materials/${discId}`, { trackUse: true })).status).toBe(200);

    // Withdraw every mark, reverse every return, then the issue itself.
    for (const o of f.get(disc)!.outcomes.filter((x) => !x.withdrawn)) {
      expect((await api('POST', `/consumable-outcomes/${o.id}/withdrawal`, { reason: 'Issued to the wrong worker' }, key())).status).toBe(201);
    }
    f = await reconcile('marks withdrawn');
    expect(f.get(disc)).toMatchObject({ usedUp: '0', broken: '0', stillOut: '8' });
    expect((await api('POST', `/inventory-transactions/${visit1.body.transactionIds[0]}/reversal`, { reason: 'Issued to the wrong worker' }, key())).status).toBe(201);
    f = await reconcile('return reversed');
    expect(f.get(disc)!.stillOut).toBe('10');
    expect((await api('POST', `/inventory-transactions/${disc}/reversal`, { reason: 'Issued to the wrong worker' }, key())).status).toBe(201);
    await reconcile('issue reversed');
    expect(await onHand(discId, rackA)).toBe(20);
  });

  // Qodo, PR #144: each checked the other before taking the lock they share.
  it('never lets a reversal and a mark or return on the same issue both go through at the same moment', async () => {
    for (let round = 0; round < 6; round++) {
      const issued = await api<{ transactionIds: string[] }>('POST', '/inventory-issues', {
        recipientId: workerId, lines: [{ materialId: discId, locationId: rackA, quantity: 2 }],
      }, key());
      expect(issued.status).toBe(201);
      const [id] = issued.body.transactionIds as [string];
      const other = round % 2 === 0
        ? api('POST', `/inventory-transactions/${id}/outcomes`, { outcome: 'USED_UP', quantity: 1 }, key())
        : api('POST', '/inventory-returns', { lines: [{ issueTransactionId: id, quantity: 1 }] }, key());
      const [reversal, booking] = await Promise.all([
        api('POST', `/inventory-transactions/${id}/reversal`, { reason: 'Issued twice' }, key()),
        other,
      ]);
      expect([reversal.status, booking.status].filter((s) => s === 201), `round ${round}: ${reversal.status} and ${booking.status}`).toHaveLength(1);
      expect([reversal.status, booking.status].every((s) => s === 201 || s === 409)).toBe(true);
      expect((await checkIssuedStock(prisma)).problems, `round ${round}`).toEqual([]);
    }
  });

  it('is caught by the database check when a stored balance does not match the ledger', async () => {
    const where = { materialId_locationId_heldForProject: { materialId: gloveId, locationId: rackA, heldForProject: '' } };
    const before = await prisma.inventoryBalance.findUniqueOrThrow({ where });
    await prisma.inventoryBalance.update({ where, data: { quantity: before.quantity.plus(5) } });
    try {
      const { problems } = await checkIssuedStock(prisma);
      expect(problems).toEqual([expect.stringMatching(new RegExp(`IT-MATH-GLOVE-${run} at IT math rack A ${run}: stored balance \\d+, the ledger adds up to \\d+`))]);
    } finally {
      await prisma.inventoryBalance.update({ where, data: { quantity: before.quantity } });
    }
    expect((await checkIssuedStock(prisma)).problems).toEqual([]);
  });
});
