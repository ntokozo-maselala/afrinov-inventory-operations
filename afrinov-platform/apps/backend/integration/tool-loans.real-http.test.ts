// Real-HTTP + real-database tests for tool check-out and check-in: a tool is
// lent (LOAN), not used up, so it leaves the shelf but stays owned until it
// comes back (LOAN_RETURN) in good order or damaged, or is lost and written
// off. Loans are never reversed, cannot lend more than is in store, and two
// people cannot lend the last one at the same moment.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface OpenLoan {
  loanId: string; slipId: string | null; recipientName: string | null; projectNumber: string | null; quantity: string; out: string; daysOut: number; overdue: boolean;
  dueOn: string; daysLate: number; state: string; extensions: Array<{ dueOn: string; reason: string; extendedBy: string }>;
}
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
interface ToolRow { materialId: string; inStore: string; onLoan: string; owned: string; loans: OpenLoan[] }
interface HistoryRow { id: string; type: string; quantity: string; reasonCode: string | null; issueId: string | null; recipientName: string | null }
interface MovementRow {
  id: string; cursor: string; type: string; quantity: string | null; referenceId: string | null; reasonNote: string | null; recipientName: string | null;
  dueOn: string | null; previousDueOn: string | null; currentDueOn: string | null; daysLate: number | null; overdueOverrideReason: string | null;
}

describe('tool loans over real HTTP', () => {
  const run = runId();
  const projectNumber = `IT-TL-${run}`;
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let rackId: string;
  let recipientId: string;
  let drillId: string;
  let grinderId: string;
  let drillLoanId: string;
  let grinderLoanId: string;

  async function tool(materialId: string): Promise<ToolRow> {
    const res = await api<ToolRow[]>('GET', '/tools');
    expect(res.status).toBe(200);
    const row = res.body.find((t) => t.materialId === materialId);
    expect(row).toBeDefined();
    return row!;
  }

  /** What is on the shelf, with the stored balance checked against the ledger. */
  async function onShelf(materialId: string): Promise<string> {
    const { ledger, balance } = await ledgerAndBalance(materialId, rackId);
    expect(balance).toBe(ledger);
    return ledger;
  }

  async function newTool(name: string, stock: number): Promise<string> {
    const m = await api<{ id: string }>('POST', '/materials', { sku: `IT-TL-${name.toUpperCase()}-${run}`, name: `${name} ${run}`, category: 'TOOLS', unitOfMeasure: 'each' });
    expect(m.status).toBe(200);
    expect((await api('POST', '/inventory-adjustments', { materialId: m.body.id, locationId: rackId, quantity: stock, reasonCode: 'COUNT_VARIANCE' })).status).toBe(201);
    return m.body.id;
  }

  let users = 0;
  async function newUser(role: string) {
    // Several tests sign in as the same role, so each user gets its own address.
    const email = `it-${role.toLowerCase()}-tl-${++users}-${run}@example.com`;
    const password = `${role.toLowerCase()}-${run}-pass`;
    expect((await api('POST', '/users', { email, name: `IT ${role} ${run}`, password, roleNames: [role], mustChangePassword: false })).status).toBe(201);
    return client(server.port, await login(server.port, email, password));
  }

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));

    const rack = await api<{ id: string }>('POST', '/locations', { name: `IT tool rack ${run}`, type: 'RACK' });
    expect(rack.status).toBe(201);
    rackId = rack.body.id;
    expect((await api('POST', '/projects', { projectNumber, name: `Tool project ${run}` })).status).toBe(201);
    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `IT fitter ${run}`, type: 'WORKER' });
    expect(recipient.status).toBe(201);
    recipientId = recipient.body.id;

    drillId = await newTool('Drill', 3);
    grinderId = await newTool('Grinder', 1);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('checks tools out on one slip: off the shelf, still owned, out with the recipient', async () => {
    const res = await api<{ slipId: string; loanIds: string[] }>('POST', '/tools/check-out', {
      recipientId, projectNumber, note: 'Boiler job',
      lines: [{ materialId: drillId, locationId: rackId, quantity: 2 }, { materialId: grinderId, locationId: rackId, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.loanIds).toHaveLength(2);
    [drillLoanId, grinderLoanId] = res.body.loanIds as [string, string];

    expect(await onShelf(drillId)).toBe('1');
    expect(await onShelf(grinderId)).toBe('0');
    const drill = await tool(drillId);
    expect(drill).toMatchObject({ inStore: '1', onLoan: '2', owned: '3' });
    expect(drill.loans).toEqual([expect.objectContaining({
      loanId: drillLoanId, slipId: res.body.slipId, recipientName: `IT fitter ${run}`, projectNumber, quantity: '2', out: '2', daysOut: 0, overdue: false,
      dueOn: day(7), daysLate: -7, state: 'ON_LOAN', extensions: [],
    })]);
    expect(res.body).toMatchObject({ dueOn: day(7) });

    // Both lines share the slip, and the Tool loans report lists them.
    const report = await api<HistoryRow[]>('GET', `/inventory-transactions?report=loans&materialId=${drillId}`);
    expect(report.status).toBe(200);
    expect(report.body.map((r) => [r.type, r.quantity, r.issueId])).toEqual([['LOAN', '-2', res.body.slipId]]);
  });

  it('refuses to lend more than is in store, or something that is not a tool', async () => {
    const tooMany = await api<{ error: { code: string; message: string } }>('POST', '/tools/check-out', {
      recipientId, lines: [{ materialId: drillId, locationId: rackId, quantity: 2 }],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.message).toMatch(/only 1 in store/);

    const cable = await api<{ id: string }>('POST', '/materials', { sku: `IT-TL-CABLE-${run}`, name: `Cable ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'm' });
    expect((await api('POST', '/inventory-adjustments', { materialId: cable.body.id, locationId: rackId, quantity: 10, reasonCode: 'COUNT_VARIANCE' })).status).toBe(201);
    const notATool = await api<{ error: { message: string } }>('POST', '/tools/check-out', {
      recipientId, lines: [{ materialId: cable.body.id, locationId: rackId, quantity: 1 }],
    });
    expect(notATool.status).toBe(400);
    expect(notATool.body.error.message).toMatch(/is not a tool/);

    expect(await onShelf(drillId)).toBe('1');
  });

  it('checks a loan in part by part, in good order and then damaged, and closes it', async () => {
    expect((await api('POST', '/tools/check-in', { lines: [{ loanId: drillLoanId, quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    expect(await onShelf(drillId)).toBe('2');
    expect((await tool(drillId)).loans[0]).toMatchObject({ loanId: drillLoanId, out: '1' });

    const damaged = await api('POST', '/tools/check-in', { lines: [{ loanId: drillLoanId, quantity: 1, condition: 'DAMAGED', note: 'Chuck cracked' }] });
    expect(damaged.status).toBe(201);
    expect(await onShelf(drillId)).toBe('3');
    expect(await tool(drillId)).toMatchObject({ inStore: '3', onLoan: '0', owned: '3', loans: [] });
    // Held for repair until the store marks it repaired (system audit B2).
    const held = (await tool(drillId)) as unknown as { heldForRepair: string; repairs: Array<{ id: string }> };
    expect(held.heldForRepair).toBe('1');
    expect((await api('POST', `/tools/repairs/${held.repairs[0]!.id}/repaired`, { note: 'New chuck' })).status).toBe(200);

    const report = await api<HistoryRow[]>('GET', `/inventory-transactions?report=loans&materialId=${drillId}`);
    const returns = report.body.filter((r) => r.type === 'LOAN_RETURN');
    expect(returns.map((r) => r.reasonCode).sort()).toEqual(['DAMAGE', null].sort());
    expect(returns.every((r) => r.recipientName === `IT fitter ${run}`)).toBe(true);
  });

  it('refuses to check in more than is still out on a loan', async () => {
    const res = await api<{ error: { message: string } }>('POST', '/tools/check-in', { lines: [{ loanId: drillLoanId, quantity: 1, condition: 'GOOD' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/only 0 still checked out/);
    expect(await onShelf(drillId)).toBe('3');
  });

  it('writes off a tool lost on loan, and asks what happened first', async () => {
    const noNote = await api('POST', '/tools/check-in', { lines: [{ loanId: grinderLoanId, quantity: 1, condition: 'LOST' }] });
    expect(noNote.status).toBe(400);

    const lost = await api<{ returnIds: string[]; writeOffIds: string[] }>('POST', '/tools/check-in', {
      lines: [{ loanId: grinderLoanId, quantity: 1, condition: 'LOST', note: 'Fell into the tank' }],
    });
    expect(lost.status).toBe(201);
    expect(lost.body.returnIds).toHaveLength(1);
    expect(lost.body.writeOffIds).toHaveLength(1);

    // Back on paper and written off at once: not out, not on the shelf, no longer owned.
    expect(await onShelf(grinderId)).toBe('0');
    expect(await tool(grinderId)).toMatchObject({ inStore: '0', onLoan: '0', owned: '0', loans: [] });
    const writeOffs = await api<HistoryRow[]>('GET', `/inventory-transactions?report=writeoffs&materialId=${grinderId}`);
    // The report also holds the stock-in adjustment this suite started with.
    expect(writeOffs.body.filter((r) => r.reasonCode === 'LOSS').map((r) => [r.type, r.quantity])).toEqual([['ADJUSTMENT', '-1']]);
  });

  it('does not reverse check-outs or check-ins: the tool is checked in or out again instead', async () => {
    const report = await api<HistoryRow[]>('GET', `/inventory-transactions?report=loans&materialId=${drillId}`);
    const back = report.body.find((r) => r.type === 'LOAN_RETURN')!;
    for (const id of [drillLoanId, back.id]) {
      const res = await api<{ error: { code: string } }>('POST', `/inventory-transactions/${id}/reversal`, { reason: 'Booked by mistake' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    }
    expect(await onShelf(drillId)).toBe('3');
  });

  it('flags a loan from before due dates once it is out longer than the default loan period', async () => {
    const res = await api<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId, lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }] });
    expect(res.status).toBe(201);
    const loanId = res.body.loanIds[0]!;
    expect((await tool(drillId)).loans.find((l) => l.loanId === loanId)).toMatchObject({ daysOut: 0, overdue: false });

    // Make it a loan from before due dates, out 10 days. Only this run's own row on a test database.
    await prisma.inventoryTransaction.update({ where: { id: loanId }, data: { postedAt: new Date(Date.now() - 10 * DAY), dueOn: null } });
    expect((await tool(drillId)).loans.find((l) => l.loanId === loanId)).toMatchObject({ daysOut: 10, overdue: true, dueOn: day(-3), daysLate: 3, state: 'OVERDUE' });

    expect((await api('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    expect(await onShelf(drillId)).toBe('3');
  });

  it('holds a loan on a project to the project end date, and a chosen date to the longest loan', async () => {
    const endsSoon = `IT-TL-END-${run}`;
    expect((await api('POST', '/projects', { projectNumber: endsSoon, name: `Ends soon ${run}`, endDate: `${day(3)}T00:00:00.000Z` })).status).toBe(201);
    const capped = await api<{ dueOn: string; loanIds: string[] }>('POST', '/tools/check-out', {
      recipientId, projectNumber: endsSoon, lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }],
    });
    expect(capped.status).toBe(201);
    expect(capped.body.dueOn).toBe(day(3));

    const tooLong = await api<{ error: { message: string } }>('POST', '/tools/check-out', {
      recipientId, dueOn: day(45), lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }],
    });
    // The administrator may lend past the longest loan; the project still holds.
    expect(tooLong.status).toBe(201);
    const technician = await newUser('TECHNICIAN');
    const refused = await technician<{ error: { message: string } }>('POST', '/tools/check-out', {
      recipientId, dueOn: day(45), lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/at most 30 days/);

    const loanIds = [capped.body.loanIds[0]!, (tooLong.body as unknown as { loanIds: string[] }).loanIds[0]!];
    expect((await api('POST', '/tools/check-in', { lines: loanIds.map((loanId) => ({ loanId, quantity: 1, condition: 'GOOD' })) })).status).toBe(201);
    expect(await onShelf(drillId)).toBe('3');
  });

  it('asks for a reason before lending more to someone with an overdue tool', async () => {
    const late = await api<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId, lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }] });
    const lateId = late.body.loanIds[0]!;
    await prisma.inventoryTransaction.update({ where: { id: lateId }, data: { postedAt: new Date(Date.now() - 12 * DAY), dueOn: new Date(`${day(-5)}T00:00:00.000Z`) } });

    const asked = await api<{ error: { code: string; message: string; details: { overdueLoans: Array<{ loanId: string }> } } }>('POST', '/tools/check-out', {
      recipientId, lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }],
    });
    expect(asked.status).toBe(400);
    expect(asked.body.error.message).toMatch(/has 1 overdue tool: .*5 days late\. Give a reason/);
    expect(asked.body.error.details.overdueLoans.map((l) => l.loanId)).toEqual([lateId]);
    expect(await onShelf(drillId)).toBe('2');

    const lent = await api<{ loanIds: string[] }>('POST', '/tools/check-out', {
      recipientId, overrideReason: 'Second crew on the boiler', lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }],
    });
    expect(lent.status).toBe(201);
    expect(await onShelf(drillId)).toBe('1');
    // The reason is on the check-out itself, as Movements shows it.
    const report = await api<MovementRow[]>('GET', `/inventory-transactions?report=loans&materialId=${drillId}&limit=1`);
    expect(report.body[0]).toMatchObject({ id: lent.body.loanIds[0], overdueOverrideReason: 'Second crew on the boiler' });

    expect((await api('POST', '/tools/check-in', { lines: [lateId, lent.body.loanIds[0]!].map((loanId) => ({ loanId, quantity: 1, condition: 'GOOD' })) })).status).toBe(201);
    expect(await onShelf(drillId)).toBe('3');
  });

  it('changes a due date for the store controller, later then earlier, replays a retry, and keeps the history; a technician cannot', async () => {
    const out = await api<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId, lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }] });
    const loanId = out.body.loanIds[0]!;

    const technician = await newUser('TECHNICIAN');
    expect((await technician('POST', `/tools/loans/${loanId}/due-date`, { dueOn: day(10), reason: 'Still on site' })).status).toBe(403);

    const storeman = await newUser('STORE_CONTROLLER');
    const key = `it-due-date-${run}`;
    const first = await storeman<{ dueOn: string; previousDueOn: string; extensionId: string }>('POST', `/tools/loans/${loanId}/due-date`, { dueOn: day(10), reason: 'Still on site' }, { 'Idempotency-Key': key });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ dueOn: day(10), previousDueOn: day(7) });
    const again = await storeman<{ extensionId: string }>('POST', `/tools/loans/${loanId}/due-date`, { dueOn: day(10), reason: 'Still on site' }, { 'Idempotency-Key': key });
    expect(again.status).toBe(201);
    expect(again.body.extensionId).toBe(first.body.extensionId);
    expect(await prisma.toolLoanExtension.count({ where: { loanId } })).toBe(1);

    const same = await storeman<{ error: { message: string } }>('POST', `/tools/loans/${loanId}/due-date`, { dueOn: day(10), reason: 'Again' });
    expect(same.status).toBe(400);
    expect(same.body.error.message).toBe(`The tool is already due back on ${day(10)}.`);
    // Earlier is allowed, with a reason, and wins because it is the most recent.
    const earlier = await storeman('POST', `/tools/loans/${loanId}/due-date`, { dueOn: day(9), reason: 'Wrong day picked' });
    expect(earlier.status).toBe(201);

    const loan = (await tool(drillId)).loans.find((l) => l.loanId === loanId)!;
    expect(loan).toMatchObject({
      dueOn: day(9),
      extensions: [
        { dueOn: day(10), reason: 'Still on site', extendedBy: `IT STORE_CONTROLLER ${run}` },
        { dueOn: day(9), reason: 'Wrong day picked', extendedBy: `IT STORE_CONTROLLER ${run}` },
      ],
    });
    const audit = await prisma.auditLogEntry.findFirst({ where: { action: 'TOOL_LOAN_EXTEND', entityId: loanId }, orderBy: { createdAt: 'asc' } });
    expect(audit).toMatchObject({ before: { dueOn: day(7) }, after: expect.objectContaining({ dueOn: day(10), reason: 'Still on site' }) });

    expect((await api('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    const allBack = await storeman<{ error: { code: string } }>('POST', `/tools/loans/${loanId}/due-date`, { dueOn: day(12), reason: 'Late' });
    expect(allBack.status).toBe(409);
    expect(await onShelf(drillId)).toBe('3');

    // Movements lists the changes among the check-out and check-in, newest first, with no quantity.
    const report = await api<MovementRow[]>('GET', `/inventory-transactions?report=loans&materialId=${drillId}&limit=4`);
    expect(report.status).toBe(200);
    expect(report.body.map((r) => [r.type, r.quantity, r.dueOn, r.previousDueOn])).toEqual([
      ['LOAN_RETURN', '1', day(9), null],
      ['DUE_DATE_CHANGE', null, day(9), day(10)],
      ['DUE_DATE_CHANGE', null, day(10), day(7)],
      ['LOAN', '-1', day(7), null],
    ]);
    expect(report.body[0]).toMatchObject({ daysLate: -9 });
    expect(report.body[1]).toMatchObject({ referenceId: loanId, reasonNote: 'Wrong day picked', recipientName: `IT fitter ${run}` });
    expect(report.body[3]).toMatchObject({ currentDueOn: day(9) });
    // The cursor of the last row continues past both kinds.
    const next = await api<MovementRow[]>('GET', `/inventory-transactions?report=loans&materialId=${drillId}&limit=4&before=${encodeURIComponent(report.body[1]!.cursor)}`);
    expect(next.body.slice(0, 2).map((r) => r.type)).toEqual(['DUE_DATE_CHANGE', 'LOAN']);
    const summary = await api<{ total: number; byType: Record<string, number> }>('GET', `/inventory-transactions/summary?report=loans&materialId=${drillId}`);
    expect(summary.body.byType['DUE_DATE_CHANGE']).toBe(2);
    // Other reports leave them out.
    const writeOffs = await api<MovementRow[]>('GET', `/inventory-transactions?report=writeoffs&materialId=${drillId}`);
    expect(writeOffs.body.some((r) => r.type === 'DUE_DATE_CHANGE')).toBe(false);

    const history = await api<{ state: string | null; events: Array<{ kind: string }> }>('GET', `/tools/loans/${loanId}/history`);
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({ state: null });
    expect(history.body.events.map((e) => e.kind)).toEqual(['CHECKED_OUT', 'DUE_DATE_CHANGED', 'DUE_DATE_CHANGED', 'CHECKED_IN']);
    expect((await api('GET', `/tools/loans/${report.body[0]!.id}/history`)).status).toBe(404);
  });

  it('lets a technician lend and take back tools, and forbids a viewer', async () => {
    const technician = await newUser('TECHNICIAN');
    const out = await technician<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId, lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }] });
    expect(out.status).toBe(201);

    const viewer = await newUser('VIEWER');
    expect((await viewer('POST', '/tools/check-out', { recipientId, lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }] })).status).toBe(403);
    expect((await viewer('POST', '/tools/check-in', { lines: [{ loanId: out.body.loanIds[0], quantity: 1, condition: 'GOOD' }] })).status).toBe(403);
    expect(await onShelf(drillId)).toBe('2');

    expect((await technician('POST', '/tools/check-in', { lines: [{ loanId: out.body.loanIds[0], quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    expect(await onShelf(drillId)).toBe('3');
  });

  it('lends the last one only once when two people check it out at the same moment', async () => {
    const torchId = await newTool('Torch', 1);
    const body = { recipientId, lines: [{ materialId: torchId, locationId: rackId, quantity: 1 }] };
    const results = await Promise.all([api('POST', '/tools/check-out', body), api('POST', '/tools/check-out', body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await onShelf(torchId)).toBe('0');
    expect(await tool(torchId)).toMatchObject({ inStore: '0', onLoan: '1', owned: '1' });
  });
});
