// Real-HTTP + real-database tests for ADR-043: project material is issued
// only on the Workshop Manager's approval, or the Director standing in. The
// storeman asks; nothing moves while it waits; approving posts the issue for
// what was approved and stands as the slip's confirmation. Stores stock isn't
// issued to a project.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, workshopManager, type TestServer } from './helpers.js';

interface Failure { error: { code: string; message: string } }
interface Asked { status: string; requestId: string }
interface Approved { id: string; issueId: string; transactionIds: string[] }
interface RequestView {
  id: string; status: string; standIn: boolean; issueId: string | null; decisionNote: string | null; daysWaiting: number;
  requestedBy: { name: string }; decidedBy: { name: string } | null;
  lines: Array<{ id: string; lineNo: number; quantity: string; approvedQuantity: string | null; onHand: string | null }>;
}

describe('project issue approval over real HTTP (ADR-043)', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let storeman: ReturnType<typeof client>;
  let otherStoreman: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;
  let director: ReturnType<typeof client>;
  let job: string;
  let rack: string;
  let plate: string;
  let bolt: string;
  let welder: string;

  let users = 0;
  async function newUser(role: string) {
    const email = `it-pia-${role.toLowerCase()}-${++users}-${run}@afrinov.local`;
    const password = `It-${run}-${role.toLowerCase()}`;
    expect((await api('POST', '/users', { email, name: `IT PIA ${role} ${users} ${run}`, password, roleNames: [role], mustChangePassword: false })).status).toBe(201);
    return client(server.port, await login(server.port, email, password));
  }
  const held = async (materialId: string) => {
    const { ledger, balance } = await ledgerAndBalance(materialId, rack, job);
    expect(balance).toBe(ledger);
    return ledger;
  };
  const ask = (who: typeof api, lines: Array<{ materialId: string; quantity: number }>, projectNumber = job) =>
    who<Asked & Failure>('POST', '/issue-requests', { recipientId: welder, projectNumber, lines: lines.map((l) => ({ ...l, locationId: rack })) });
  const view = async (id: string, status = 'PENDING') =>
    (await api<RequestView[]>('GET', `/issue-requests?status=${status}`)).body.find((r) => r.id === id)!;

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    storeman = await newUser('STORE_CONTROLLER');
    otherStoreman = await newUser('STORE_CONTROLLER');
    manager = await workshopManager(server.port, api, run);
    director = await newUser('DIRECTOR');
    job = `IT-PIA-${run}`;
    expect((await api('POST', '/projects', { projectNumber: job, name: `Approval job ${run}`, status: 'ACTIVE' })).status).toBe(201);
    rack = (await api<{ id: string }>('POST', '/locations', { name: `IT PIA rack ${run}`, type: 'RACK' })).body.id;
    plate = (await api<{ id: string }>('POST', '/materials', { sku: `IT-PIA-PL-${run}`, name: `Plate ${run}`, category: 'PROJECT_MATERIAL', unitOfMeasure: 'each', unitCost: 100 })).body.id;
    bolt = (await api<{ id: string }>('POST', '/materials', { sku: `IT-PIA-BO-${run}`, name: `Bolt ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: 2 })).body.id;
    welder = (await api<{ id: string }>('POST', '/recipients', { name: `IT PIA welder ${run}`, type: 'WORKER' })).body.id;
    // 10 plates held for the job; bolts as Stores stock and 6 held for it.
    for (const [materialId, quantity, heldForProject] of [[plate, 10, job], [bolt, 50, undefined], [bolt, 6, job]] as const) {
      expect((await api('POST', '/inventory-adjustments', { materialId, locationId: rack, quantity, reasonCode: 'FOUND', reasonNote: 'Opening stock', heldForProject })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await server?.close();
  });

  it('refuses project material straight from the counter, and Stores stock on a project issue', async () => {
    const direct = await storeman<Failure>('POST', '/inventory-issues', {
      recipientId: welder, projectNumber: job, lines: [{ materialId: plate, locationId: rack, quantity: 1, heldForProject: job }],
    });
    expect(direct.status).toBe(400);
    expect(direct.body.error.message).toMatch(/Project material is issued on the Workshop Manager's approval/);
    const stores = await storeman<Failure>('POST', '/inventory-issues', {
      recipientId: welder, projectNumber: job, lines: [{ materialId: bolt, locationId: rack, quantity: 1 }],
    });
    expect(stores.status).toBe(400);
    // A Stores issue with no project still posts at once.
    expect((await storeman('POST', '/inventory-issues', { recipientId: welder, lines: [{ materialId: bolt, locationId: rack, quantity: 1 }] })).status).toBe(201);
    expect(await held(plate)).toBe('10');
  });

  it('holds a request until the Workshop Manager approves it, possibly for less, then posts it as the storeman\'s, confirmed by the approval', async () => {
    const asked = await ask(storeman, [{ materialId: plate, quantity: 4 }, { materialId: bolt, quantity: 6 }]);
    expect([asked.status, asked.body.status]).toEqual([202, 'PENDING_APPROVAL']);
    expect(await held(plate)).toBe('10');
    const waiting = await view(asked.body.requestId);
    expect(waiting.lines.map((l) => [l.quantity, l.onHand])).toEqual([['4', '10'], ['6', '6']]);

    // What waits counts against the stock: the 6 bolts are spoken for.
    const more = await ask(otherStoreman, [{ materialId: bolt, quantity: 1 }]);
    expect([more.status, more.body.error.code]).toEqual([422, 'INSUFFICIENT_BALANCE']);
    expect(more.body.error.message).toMatch(/6 of it is already waiting for approval/);

    // Not the storeman, nor an Admin who holds neither role.
    expect((await storeman('POST', `/issue-requests/${asked.body.requestId}/approve`, {})).status).toBe(403);
    const admin = await api<Failure>('POST', `/issue-requests/${asked.body.requestId}/approve`, {});
    expect(admin.status).toBe(403);
    expect(admin.body.error.message).toMatch(/approved by the Workshop Manager, or the Director standing in/);

    const lines = waiting.lines;
    const tooMuch = await manager<Failure>('POST', `/issue-requests/${asked.body.requestId}/approve`, { lines: [{ lineId: lines[0]!.id, quantity: 5 }] });
    expect(tooMuch.status).toBe(400);
    const approved = await manager<Approved>('POST', `/issue-requests/${asked.body.requestId}/approve`, {
      lines: [{ lineId: lines[0]!.id, quantity: 3 }, { lineId: lines[1]!.id, quantity: 0 }], note: 'Three for now',
    });
    expect(approved.status).toBe(201);
    expect(approved.body.transactionIds).toHaveLength(1);
    expect(await held(plate)).toBe('7');
    expect(await held(bolt)).toBe('6');

    const posted = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: approved.body.transactionIds[0]! }, include: { actor: true } });
    expect(posted).toMatchObject({ type: 'ISSUE', projectNumber: job, heldForProject: job, recipientId: welder, issueId: approved.body.issueId });
    expect(posted.actor.email).toMatch(/^it-pia-store_controller-1-/);

    const decided = await view(asked.body.requestId, 'APPROVED');
    expect(decided).toMatchObject({ status: 'APPROVED', standIn: false, issueId: approved.body.issueId, decisionNote: 'Three for now' });
    expect(decided.lines.map((l) => l.approvedQuantity)).toEqual(['3', '0']);

    // The approval is the slip's confirmation: nothing more is asked of the welder.
    const receipt = await prisma.receiptConfirmation.findFirstOrThrow({ where: { slipId: approved.body.issueId }, include: { capturedBy: true } });
    expect(receipt).toMatchObject({ method: 'APPROVAL', signerId: null });
    expect(receipt.capturedBy.email).toBe(`it-workshop-${run}@afrinov.local`);
    const again = await storeman<Failure>('POST', `/slips/${approved.body.issueId}/confirmation`, { method: 'NONE', reason: 'LEFT' });
    expect([again.status, again.body.error.code]).toEqual([409, 'ALREADY_CONFIRMED']);

    // Deciding twice does nothing more.
    expect((await manager('POST', `/issue-requests/${asked.body.requestId}/approve`, {})).status).toBe(409);
    expect(await held(plate)).toBe('7');
  });

  it('takes the Director standing in, and records that they did', async () => {
    const asked = await ask(storeman, [{ materialId: plate, quantity: 1 }]);
    const approved = await director<Approved>('POST', `/issue-requests/${asked.body.requestId}/approve`, {});
    expect(approved.status).toBe(201);
    expect((await view(asked.body.requestId, 'APPROVED')).standIn).toBe(true);
    expect(await held(plate)).toBe('6');
  });

  it('posts nothing when rejected with a reason, or cancelled by whoever asked', async () => {
    const asked = await ask(storeman, [{ materialId: plate, quantity: 2 }]);
    expect((await manager('POST', `/issue-requests/${asked.body.requestId}/reject`, { reason: '' })).status).toBe(400);
    expect((await storeman('POST', `/issue-requests/${asked.body.requestId}/reject`, { reason: 'Mine' })).status).toBe(403);
    expect((await manager('POST', `/issue-requests/${asked.body.requestId}/reject`, { reason: 'Use the offcuts first' })).status).toBe(200);
    expect(await view(asked.body.requestId, 'REJECTED')).toMatchObject({ decisionNote: 'Use the offcuts first' });

    const mine = await ask(storeman, [{ materialId: plate, quantity: 2 }]);
    expect((await otherStoreman('POST', `/issue-requests/${mine.body.requestId}/cancel`, { reason: 'Not yours' })).status).toBe(403);
    expect((await storeman('POST', `/issue-requests/${mine.body.requestId}/cancel`, { reason: 'Wrong recipient' })).status).toBe(200);
    expect((await manager('POST', `/issue-requests/${mine.body.requestId}/approve`, {})).status).toBe(409);
    expect(await held(plate)).toBe('6');
    const own = (await storeman<RequestView[]>('GET', '/issue-requests?status=CANCELLED&mine=true')).body;
    expect(own.map((r) => r.id)).toContain(mine.body.requestId);
  });

  it('checks the stock again on approval, and keeps it waiting when the stock is gone', async () => {
    const asked = await ask(storeman, [{ materialId: plate, quantity: 6 }]);
    // Meanwhile two are found damaged.
    expect((await api('POST', '/inventory-adjustments', { materialId: plate, locationId: rack, quantity: -2, reasonCode: 'DAMAGE', heldForProject: job })).status).toBe(201);
    const refused = await manager<Failure>('POST', `/issue-requests/${asked.body.requestId}/approve`, {});
    expect([refused.status, refused.body.error.code]).toEqual([422, 'INSUFFICIENT_BALANCE']);
    expect(await held(plate)).toBe('4');
    expect((await view(asked.body.requestId)).status).toBe('PENDING');
    // It can still be approved for what is there.
    const line = (await view(asked.body.requestId)).lines[0]!;
    expect((await manager('POST', `/issue-requests/${asked.body.requestId}/approve`, { lines: [{ lineId: line.id, quantity: 4 }] })).status).toBe(201);
    expect(await held(plate)).toBe('0');
  });

  it('keeps the project open while an issue of it waits', async () => {
    expect((await api('POST', '/inventory-adjustments', { materialId: plate, locationId: rack, quantity: 1, reasonCode: 'FOUND', reasonNote: 'Recount', heldForProject: job })).status).toBe(201);
    const asked = await ask(storeman, [{ materialId: plate, quantity: 1 }]);
    const close = await api<Failure>('PATCH', `/projects/${job}`, { status: 'COMPLETED' });
    expect(close.status).toBe(409);
    expect(close.body.error.message).toMatch(/1 issue of its material waiting for the Workshop Manager/);
    expect((await storeman('POST', `/issue-requests/${asked.body.requestId}/cancel`, { reason: 'Job finished' })).status).toBe(200);
    const summary = await manager<{ waiting: number }>('GET', '/issue-requests/summary');
    expect(summary.status).toBe(200);
  });
});
