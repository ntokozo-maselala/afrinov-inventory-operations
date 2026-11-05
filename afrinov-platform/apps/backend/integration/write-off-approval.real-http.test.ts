// Real-HTTP + real-database tests for write-off approval: an adjustment worth
// more than inventory.writeOffApprovalAbove (or of an item with no unit cost)
// moves no stock until someone other than whoever asked for it approves it,
// and a borrower cannot write off a tool they borrowed.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Outcome { status: 'POSTED' | 'PENDING_APPROVAL'; transactionId?: string; requestId?: string; value?: string | null; limit?: string; error?: { code: string; message: string } }
interface Request { id: string; status: string; quantity: string; value: string | null; requestedBy: { name: string }; decidedBy: { name: string } | null; transactionId: string | null; decisionNote: string | null }

describe('write-off approval over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let storeman: ReturnType<typeof client>;
  let materialId: string;
  let unpricedId: string;
  let locationId: string;
  let approvalWas: unknown;
  let limitWas: unknown;

  const adjust = (who: typeof api, body: Record<string, unknown>) => who<Outcome>('POST', '/inventory-adjustments', { materialId, locationId, ...body });
  const onHand = async (item = materialId) => {
    const { ledger, balance } = await ledgerAndBalance(item, locationId);
    expect(balance).toBe(ledger);
    return ledger;
  };
  const setting = (key: string, value: unknown) => prisma.setting.update({ where: { key }, data: { value: value as never } });

  let users = 0;
  async function newUser(role: string) {
    const email = `it-wo-${role.toLowerCase()}-${++users}-${run}@afrinov.local`;
    const password = `It-${run}-${role.toLowerCase()}`;
    expect((await api('POST', '/users', { email, name: `IT WO ${role} ${users} ${run}`, password, roleNames: [role] })).status).toBe(201);
    return client(server.port, await login(server.port, email, password));
  }

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    storeman = await newUser('STORE_CONTROLLER');
    const location = await api<{ id: string }>('POST', '/locations', { name: `IT WO store ${run}`, type: 'STOREROOM' });
    locationId = location.body.id;
    // Opening stock goes in with approval still off, as startServer leaves it.
    const m = await api<{ id: string }>('POST', '/materials', { sku: `IT-WO-${run}`, name: `Write-off cable ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'm', unitCost: 250 });
    const u = await api<{ id: string }>('POST', '/materials', { sku: `IT-WO-U-${run}`, name: `Unpriced bolt ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each' });
    materialId = m.body.id;
    unpricedId = u.body.id;
    expect((await adjust(api, { quantity: 20, reasonCode: 'COUNT_VARIANCE', reasonNote: 'Opening count' })).status).toBe(201);
    expect((await adjust(api, { materialId: unpricedId, quantity: 20, reasonCode: 'COUNT_VARIANCE', reasonNote: 'Opening count' })).status).toBe(201);

    approvalWas = (await prisma.setting.findUniqueOrThrow({ where: { key: 'inventory.requireWriteOffApproval' } })).value;
    limitWas = (await prisma.setting.findUniqueOrThrow({ where: { key: 'inventory.writeOffApprovalAbove' } })).value;
    await setting('inventory.requireWriteOffApproval', true);
    await setting('inventory.writeOffApprovalAbove', 1000);
  });

  afterAll(async () => {
    await setting('inventory.requireWriteOffApproval', approvalWas);
    await setting('inventory.writeOffApprovalAbove', limitWas);
    await server?.close();
  });

  it('posts a write-off within the limit at once', async () => {
    const res = await adjust(storeman, { quantity: -2, reasonCode: 'LOSS', reasonNote: 'Cut short' }); // R 500
    expect([res.status, res.body.status]).toEqual([201, 'POSTED']);
    expect(await onHand()).toBe('18');
  });

  it('holds one over the limit until someone else approves it, then posts it as asked', async () => {
    const asked = await adjust(storeman, { quantity: -8, reasonCode: 'LOSS', reasonNote: 'Missing after the weekend' }); // R 2 000
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({ status: 'PENDING_APPROVAL', value: '2000.00', limit: '1000.00' });
    expect(await onHand()).toBe('18');

    const waiting = (await storeman<Request[]>('GET', '/adjustment-requests')).body.find((r) => r.id === asked.body.requestId);
    expect(waiting).toMatchObject({ status: 'PENDING', quantity: '-8', value: '2000.00', transactionId: null });

    const own = await storeman<{ error: { message: string } }>('POST', `/adjustment-requests/${asked.body.requestId}/approve`);
    expect(own.status).toBe(403);
    expect(own.body.error.message).toBe('You asked for this adjustment, so someone else must approve it.');
    expect(await onHand()).toBe('18');

    const approved = await api<{ transactionId: string }>('POST', `/adjustment-requests/${asked.body.requestId}/approve`);
    expect(approved.status).toBe(201);
    expect(await onHand()).toBe('10');
    const posted = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: approved.body.transactionId }, include: { actor: true } });
    expect(posted).toMatchObject({ type: 'ADJUSTMENT', reasonCode: 'LOSS', reasonNote: 'Missing after the weekend' });
    expect(posted.actor.email).toMatch(/^it-wo-store_controller-/);
    const decided = await prisma.adjustmentRequest.findUniqueOrThrow({ where: { id: asked.body.requestId! }, include: { decidedBy: true } });
    expect(decided).toMatchObject({ status: 'APPROVED', transactionId: approved.body.transactionId });
    expect(decided.decidedBy?.email).toBe(ADMIN_EMAIL);

    // Approving twice posts nothing more.
    expect((await api('POST', `/adjustment-requests/${asked.body.requestId}/approve`)).status).toBe(409);
    expect(await onHand()).toBe('10');
  });

  it('holds stock appearing from nowhere too, and posts nothing when it is rejected', async () => {
    const asked = await adjust(storeman, { quantity: 30, reasonCode: 'OTHER', reasonNote: 'Found in the yard' }); // R 7 500
    expect(asked.status).toBe(202);
    expect((await api('POST', `/adjustment-requests/${asked.body.requestId}/reject`, { reason: '' })).status).toBe(400);
    const rejected = await api('POST', `/adjustment-requests/${asked.body.requestId}/reject`, { reason: 'Count it first' });
    expect(rejected.status).toBe(200);
    expect(await onHand()).toBe('10');
    const listed = (await storeman<Request[]>('GET', '/adjustment-requests?status=REJECTED')).body.find((r) => r.id === asked.body.requestId);
    expect(listed).toMatchObject({ status: 'REJECTED', decisionNote: 'Count it first' });
  });

  it('holds any adjustment of an item with no unit cost, which whoever asked may withdraw', async () => {
    const asked = await adjust(storeman, { materialId: unpricedId, quantity: -1, reasonCode: 'DAMAGE', reasonNote: 'Thread stripped' });
    expect(asked.status).toBe(202);
    expect(asked.body.value).toBeNull();
    expect((await storeman('POST', `/adjustment-requests/${asked.body.requestId}/reject`, { reason: 'Booked on the wrong item' })).status).toBe(200);
    expect(await onHand(unpricedId)).toBe('20');
  });

  it('checks the stock again when approving, and refuses what is no longer there', async () => {
    const asked = await adjust(storeman, { quantity: -10, reasonCode: 'SCRAP', reasonNote: 'Water damage' }); // R 2 500, all of it
    expect(asked.status).toBe(202);
    // Meanwhile 4 m are issued. (Adjusting it again is refused while this waits.)
    const fitter = await api<{ id: string }>('POST', '/recipients', { name: `IT WO cable fitter ${run}`, type: 'WORKER' });
    expect((await storeman('POST', '/inventory-issues', { recipientId: fitter.body.id, lines: [{ materialId, locationId, quantity: 4 }] })).status).toBe(201);
    const refused = await api<{ error: { code: string } }>('POST', `/adjustment-requests/${asked.body.requestId}/approve`);
    expect(refused.status).toBe(422);
    expect(await onHand()).toBe('6');
    expect((await prisma.adjustmentRequest.findUniqueOrThrow({ where: { id: asked.body.requestId! } })).status).toBe('PENDING');
    expect((await api('POST', `/adjustment-requests/${asked.body.requestId}/reject`, { reason: 'Issued since' })).status).toBe(200);
  });

  // Qodo, PR #151: with one waiting, approving both would correct the same shortfall twice.
  it('refuses another adjustment of the same stock while one waits for approval', async () => {
    const asked = await adjust(storeman, { quantity: -5, reasonCode: 'LOSS', reasonNote: 'Missing' }); // R 1 250
    expect(asked.status).toBe(202);
    const before = await onHand();
    for (const body of [{ quantity: -1, reasonCode: 'LOSS', reasonNote: 'The same shortfall' }, { quantity: -5, reasonCode: 'LOSS', reasonNote: 'Booked again' }]) {
      const again = await adjust(storeman, body);
      expect([again.status, again.body.error?.code]).toEqual([409, 'INVALID_STATE']);
      expect(again.body.error?.message).toBe(`IT-WO-${run} here already has an adjustment waiting for approval. Approve or reject it under Write-offs to approve, then adjust again.`);
    }
    expect(await onHand()).toBe(before);
    expect((await api('POST', `/adjustment-requests/${asked.body.requestId}/reject`, { reason: 'Counted instead' })).status).toBe(200);
    expect((await adjust(storeman, { quantity: -1, reasonCode: 'LOSS', reasonNote: 'Now on its own' })).status).toBe(201);
  });

  it('refuses one that could not be posted at all when it is asked for', async () => {
    const res = await adjust(storeman, { quantity: -100, reasonCode: 'LOSS', reasonNote: 'Everything' });
    expect(res.status).toBe(422);
  });

  it('lets only those who approve write-offs reject another person\'s', async () => {
    const asked = await adjust(storeman, { quantity: 10, reasonCode: 'OTHER', reasonNote: 'Returned by a contractor' });
    const technician = await newUser('TECHNICIAN');
    expect((await technician('POST', `/adjustment-requests/${asked.body.requestId}/approve`)).status).toBe(403);
    expect((await technician('POST', `/adjustment-requests/${asked.body.requestId}/reject`, { reason: 'No' })).status).toBe(403);
    expect((await technician('GET', '/adjustment-requests')).status).toBe(403);
    const colleague = await newUser('STORE_CONTROLLER');
    expect((await colleague('POST', `/adjustment-requests/${asked.body.requestId}/approve`)).status).toBe(201);
  });

  it('lets a borrower check a tool in as good or damaged, but not write it off as lost', async () => {
    const drill = await api<{ id: string }>('POST', '/materials', { sku: `IT-WO-DRILL-${run}`, name: `Drill ${run}`, category: 'TOOLS', unitOfMeasure: 'each', unitCost: 100 });
    expect((await adjust(api, { materialId: drill.body.id, quantity: 2, reasonCode: 'COUNT_VARIANCE', reasonNote: 'Opening count' })).status).toBe(201);
    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `IT WO fitter ${run}`, type: 'WORKER' });
    const technician = await newUser('TECHNICIAN');
    const out = await technician<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId: recipient.body.id, lines: [{ materialId: drill.body.id, locationId, quantity: 2 }] });
    expect(out.status).toBe(201);
    const [loanId] = out.body.loanIds;
    const lost = await technician<{ error: { message: string } }>('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'LOST', note: 'Left on site' }] });
    expect(lost.status).toBe(403);
    expect(lost.body.error.message).toMatch(/^Checking a tool in as lost writes it off, which the store does\./);
    expect((await technician('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    expect((await storeman('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'LOST', note: 'Left on site' }] })).status).toBe(201);
  });

  // Qodo, PR #151: the value is compared exactly, not rounded to cents first.
  it('holds an adjustment worth a fraction of a cent over the limit', async () => {
    const m = await api<{ id: string }>('POST', '/materials', { sku: `IT-WO-EDGE-${run}`, name: `Edge ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 1000.004 });
    const res = await adjust(storeman, { materialId: m.body.id, quantity: 1, reasonCode: 'OTHER', reasonNote: 'Found' });
    expect([res.status, res.body.value]).toEqual([202, '1000.00']);
  });

  // Qodo, PR #151: "0: every adjustment waits", an item that costs nothing included.
  it('holds every adjustment when the limit is 0', async () => {
    const free = await api<{ id: string }>('POST', '/materials', { sku: `IT-WO-FREE-${run}`, name: `Free sample ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 0 });
    await setting('inventory.writeOffApprovalAbove', 0);
    try {
      expect((await adjust(storeman, { materialId: free.body.id, quantity: 1, reasonCode: 'OTHER', reasonNote: 'Sample' })).status).toBe(202);
    } finally {
      await setting('inventory.writeOffApprovalAbove', 1000);
    }
  });

  // Qodo, PR #151: undoing an approved write-off would add the stock back on one person's say-so.
  it('refuses to reverse an adjustment over the limit, and reverses one within it', async () => {
    const asked = await adjust(storeman, { quantity: 5, reasonCode: 'OTHER', reasonNote: 'Returned by a supplier' }); // R 1 250
    const approved = await api<{ transactionId: string }>('POST', `/adjustment-requests/${asked.body.requestId}/approve`);
    const before = await onHand();
    const refused = await storeman<{ error: { code: string; message: string } }>('POST', `/inventory-transactions/${approved.body.transactionId}/reversal`, { reason: 'Booked twice' });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'INVALID_STATE']);
    expect(refused.body.error.message).toMatch(/over the write-off limit/);
    expect(await onHand()).toBe(before);
    const row = (await storeman<Array<{ id: string; reversalNeedsApproval: boolean }>>('GET', `/inventory-transactions?materialId=${materialId}`)).body
      .find((r) => r.id === approved.body.transactionId);
    expect(row?.reversalNeedsApproval).toBe(true);

    const small = await adjust(storeman, { quantity: 1, reasonCode: 'OTHER', reasonNote: 'Miscount' }); // R 250
    expect((await storeman('POST', `/inventory-transactions/${small.body.transactionId}/reversal`, { reason: 'Miscount' })).status).toBe(201);
  });

  // Qodo, PR #151: a lost tool over the limit, or with no cost, is written off only once someone else approves.
  // Qodo, PR #151: a lost tool over the limit, or with no cost, is written off
  // only once someone else approves. Until then it stays on loan, so it can't be
  // lent again; approval posts its return and write-off against the loan and its
  // project, and a rejection leaves it with the borrower.
  it('keeps a costly lost tool on loan until its write-off is approved, then writes it off against the loan', async () => {
    const grinder = await api<{ id: string }>('POST', '/materials', { sku: `IT-WO-GRIND-${run}`, name: `Angle grinder ${run}`, category: 'TOOLS', unitOfMeasure: 'each', unitCost: 2400 });
    await setting('inventory.requireWriteOffApproval', false);
    expect((await adjust(api, { materialId: grinder.body.id, quantity: 3, reasonCode: 'OTHER', reasonNote: 'Opening count' })).status).toBe(201);
    await setting('inventory.requireWriteOffApproval', true);
    const projectNumber = `IT-WO-P-${run}`;
    expect((await api('POST', '/projects', { projectNumber, name: `IT write-off project ${run}` })).status).toBe(201);
    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `IT WO welder ${run}`, type: 'WORKER' });
    const out = await storeman<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId: recipient.body.id, projectNumber, lines: [{ materialId: grinder.body.id, locationId, quantity: 2 }] });
    expect(out.status).toBe(201);
    const [loanId] = out.body.loanIds;

    const lost = await storeman<{ returnIds: string[]; writeOffIds: string[]; writeOffRequestIds: string[] }>('POST', '/tools/check-in', { lines: [
      { loanId, quantity: 1, condition: 'LOST', note: 'Fell off the scaffold' },
      { loanId, quantity: 1, condition: 'LOST', note: 'Stolen from the van' },
    ] });
    expect(lost.status).toBe(201);
    expect([lost.body.returnIds, lost.body.writeOffIds, lost.body.writeOffRequestIds.length]).toEqual([[], [], 2]);
    // Both still on loan: the one left in store is all that can be lent.
    expect(await onHand(grinder.body.id)).toBe('1');
    const row = (await storeman<Array<{ materialId: string; loans: Array<{ loanId: string; out: string; lostWaiting: string }> }>>('GET', '/tools')).body
      .find((t) => t.materialId === grinder.body.id)!;
    expect(row.loans.find((l) => l.loanId === loanId)).toMatchObject({ out: '2', lostWaiting: '2' });
    expect((await storeman('POST', '/tools/check-out', { recipientId: recipient.body.id, lines: [{ materialId: grinder.body.id, locationId, quantity: 2 }] })).status).toBe(422);
    expect((await storeman('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'GOOD' }] })).status).toBe(400);

    const [first, second] = lost.body.writeOffRequestIds;
    expect((await storeman('POST', `/adjustment-requests/${first}/approve`)).status).toBe(403);
    const approved = await api<{ transactionId: string }>('POST', `/adjustment-requests/${first}/approve`);
    expect(approved.status).toBe(201);
    const writeOff = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: approved.body.transactionId } });
    expect(writeOff).toMatchObject({ type: 'ADJUSTMENT', reasonCode: 'LOSS', referenceType: 'ToolLoan', referenceId: loanId, projectNumber });
    expect((await prisma.inventoryTransaction.findMany({ where: { type: 'LOAN_RETURN', referenceId: loanId } })).map((t) => t.quantity.toString())).toEqual(['1']);
    // Its return and its loss net to nothing in store.
    expect(await onHand(grinder.body.id)).toBe('1');

    // Rejected: the other stays on loan to the welder, to be brought back.
    expect((await api('POST', `/adjustment-requests/${second}/reject`, { reason: 'Found in the van' })).status).toBe(200);
    expect((await storeman('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    expect(await onHand(grinder.body.id)).toBe('2');
  });

  // Qodo, PR #151: two lost lines of R 600 under a R 1 000 limit are R 1 200 written off.
  it('decides the lost tools of one check-in together, so splitting them does not dodge the limit', async () => {
    const saw = await api<{ id: string }>('POST', '/materials', { sku: `IT-WO-SAW-${run}`, name: `Jigsaw ${run}`, category: 'TOOLS', unitOfMeasure: 'each', unitCost: 600 });
    await setting('inventory.requireWriteOffApproval', false);
    expect((await adjust(api, { materialId: saw.body.id, quantity: 2, reasonCode: 'OTHER', reasonNote: 'Opening count' })).status).toBe(201);
    await setting('inventory.requireWriteOffApproval', true);
    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `IT WO joiner ${run}`, type: 'WORKER' });
    const out = await storeman<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId: recipient.body.id, lines: [{ materialId: saw.body.id, locationId, quantity: 2 }] });
    const [loanId] = out.body.loanIds;
    const lost = await storeman<{ writeOffIds: string[]; writeOffRequestIds: string[]; heldLoanIds: string[] }>('POST', '/tools/check-in', { lines: [
      { loanId, quantity: 1, condition: 'LOST', note: 'Left on site' },
      { loanId, quantity: 1, condition: 'LOST', note: 'Left on site too' },
    ] });
    expect(lost.status).toBe(201);
    expect([lost.body.writeOffIds, lost.body.writeOffRequestIds.length, lost.body.heldLoanIds]).toEqual([[], 2, [loanId, loanId]]);
    expect(await prisma.inventoryTransaction.count({ where: { materialId: saw.body.id, type: 'ADJUSTMENT', reasonCode: 'LOSS' } })).toBe(0);
  });

  // Qodo, PR #151: as approving any adjustment refuses a retired item.
  it('refuses to write off a lost tool retired while its write-off waited', async () => {
    const level = await api<{ id: string }>('POST', '/materials', { sku: `IT-WO-LEVEL-${run}`, name: `Laser level ${run}`, category: 'TOOLS', unitOfMeasure: 'each', unitCost: 3000 });
    await setting('inventory.requireWriteOffApproval', false);
    expect((await adjust(api, { materialId: level.body.id, quantity: 1, reasonCode: 'OTHER', reasonNote: 'Opening count' })).status).toBe(201);
    await setting('inventory.requireWriteOffApproval', true);
    const recipient = await api<{ id: string }>('POST', '/recipients', { name: `IT WO surveyor ${run}`, type: 'WORKER' });
    const out = await storeman<{ loanIds: string[] }>('POST', '/tools/check-out', { recipientId: recipient.body.id, lines: [{ materialId: level.body.id, locationId, quantity: 1 }] });
    const [loanId] = out.body.loanIds;
    const lost = await storeman<{ writeOffRequestIds: string[] }>('POST', '/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'LOST', note: 'Dropped in the dam' }] });
    const [requestId] = lost.body.writeOffRequestIds;
    expect((await api('PATCH', `/materials/${level.body.id}`, { active: false })).status).toBe(200);
    const refused = await api<{ error: { code: string; message: string } }>('POST', `/adjustment-requests/${requestId}/approve`);
    expect([refused.status, refused.body.error.message]).toEqual([400, 'Material is inactive']);
    expect((await prisma.adjustmentRequest.findUniqueOrThrow({ where: { id: requestId! } })).status).toBe('PENDING');
    expect(await prisma.inventoryTransaction.count({ where: { type: 'LOAN_RETURN', referenceId: loanId } })).toBe(0);
  });

  // Qodo, PR #151: a count is no way round the write-off limit.
  it('holds a count difference over the limit for approval, posting it as part of the count once approved', async () => {
    // An earlier test left one of this item's adjustments waiting; it is decided first.
    for (const r of (await api<Array<{ id: string; material: { id: string } }>>('GET', '/adjustment-requests')).body.filter((x) => x.material.id === materialId)) {
      expect((await api('POST', `/adjustment-requests/${r.id}/reject`, { reason: 'Superseded by the count' })).status).toBe(200);
    }
    const counted = Number(await onHand()) - 8; // R 2 000 short
    const count = await storeman<{ countId: string; adjusted: number; waitingForApproval: number; lines: Array<{ requestId: string | null }> }>('POST', '/stock-counts', {
      locationId, note: `IT count ${run}`, lines: [{ materialId, expectedQuantity: Number(await onHand()), countedQuantity: counted }],
    });
    expect(count.status).toBe(201);
    expect([count.body.adjusted, count.body.waitingForApproval]).toEqual([0, 1]);
    const requestId = count.body.lines[0]!.requestId!;
    // Counting it again while it waits would correct it twice.
    const again = await storeman<{ error: { code: string } }>('POST', '/stock-counts', { locationId, lines: [{ materialId, expectedQuantity: Number(await onHand()), countedQuantity: counted }] });
    expect([again.status, again.body.error.code]).toEqual([409, 'INVALID_STATE']);

    // Nor can the shortfall be booked by hand meanwhile (Qodo, PR #151).
    const byHand = await adjust(storeman, { quantity: -8, reasonCode: 'LOSS', reasonNote: 'The shortfall the count found' });
    expect([byHand.status, byHand.body.error?.code]).toEqual([409, 'INVALID_STATE']);

    const approved = await api<{ transactionId: string }>('POST', `/adjustment-requests/${requestId}/approve`);
    expect(approved.status).toBe(201);
    expect(await onHand()).toBe(String(counted));
    const posted = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: approved.body.transactionId } });
    expect(posted).toMatchObject({ reasonCode: 'COUNT_VARIANCE', referenceType: 'StockCount', referenceId: count.body.countId });
  });
});
