// Real-HTTP + real-database tests for tool check-out and check-in: a tool is
// lent (LOAN), not used up, so it leaves the shelf but stays owned until it
// comes back (LOAN_RETURN) in good order or damaged, or is lost and written
// off. Loans are never reversed, cannot lend more than is in store, and two
// people cannot lend the last one at the same moment.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface OpenLoan { loanId: string; slipId: string | null; recipientName: string | null; projectNumber: string | null; quantity: string; out: string; daysOut: number; overdue: boolean }
interface ToolRow { materialId: string; inStore: string; onLoan: string; owned: string; loans: OpenLoan[] }
interface HistoryRow { id: string; type: string; quantity: string; reasonCode: string | null; issueId: string | null; recipientName: string | null }

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

  async function newUser(role: string) {
    const email = `it-${role.toLowerCase()}-tl-${run}@example.com`;
    const password = `${role.toLowerCase()}-${run}-pass`;
    expect((await api('POST', '/users', { email, name: `IT ${role} ${run}`, password, roleNames: [role] })).status).toBe(201);
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
    })]);

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

    const report = await api<HistoryRow[]>('GET', `/inventory-transactions?report=loans&materialId=${drillId}`);
    const returns = report.body.filter((r) => r.type === 'LOAN_RETURN');
    expect(returns.map((r) => r.reasonCode).sort()).toEqual(['DAMAGE', null].sort());
    expect(returns.every((r) => r.recipientName === `IT fitter ${run}`)).toBe(true);
  });

  it('refuses to check in more than is still out on a loan', async () => {
    const res = await api<{ error: { message: string } }>('POST', '/tools/check-in', { lines: [{ loanId: drillLoanId, quantity: 1, condition: 'GOOD' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/only 0 still out/);
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

  it('flags a tool out longer than the overdue setting', async () => {
    const res = await api<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId, lines: [{ materialId: drillId, locationId: rackId, quantity: 1 }] });
    expect(res.status).toBe(201);
    const loanId = res.body.loanIds[0]!;
    expect((await tool(drillId)).loans.find((l) => l.loanId === loanId)).toMatchObject({ daysOut: 0, overdue: false });

    // Age the loan past the default of 7 days. Only this run's own row on a test database.
    await prisma.inventoryTransaction.update({ where: { id: loanId }, data: { postedAt: new Date(Date.now() - 10 * 86_400_000) } });
    expect((await tool(drillId)).loans.find((l) => l.loanId === loanId)).toMatchObject({ daysOut: 10, overdue: true });

    expect((await api('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    expect(await onShelf(drillId)).toBe('3');
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
