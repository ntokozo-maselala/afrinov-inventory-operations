// Real-HTTP + real-database tests for proof of receipt (ADR-034): the person
// collecting an issue or a tool loan confirms the slip with their counter
// PIN, a signature or a photo of the signed slip, or the reason they didn't
// is kept. What only a real database shows: a wrong PIN is counted although
// the confirmation is refused, a slip is confirmed once even under a retry,
// and a confirmation never moves stock.
//
// Run with: npm run test:integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ADMIN_EMAIL, client, ledgerAndBalance, login, prisma, requireAdminPassword, runId, startServer, type TestServer } from './helpers.js';

interface Recipient { id: string; pinSet: boolean; pinLocked: boolean; pinFailedTries: number; pinHash?: unknown }
interface Receipt { method: string; signerName: string | null; collectedFor: boolean; reason: string | null; changed: boolean; hasImage: boolean }
interface Slip { id: string; receipt: Receipt | null; lines: Array<{ id: string }> }
type Err = { error: { code: string; message: string; details?: { triesLeft?: number } } };

// The smallest valid PNG: a 1x1 transparent pixel.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('proof of receipt over real HTTP', () => {
  const run = runId();
  let server: TestServer;
  let api: ReturnType<typeof client>;
  let materialId: string;
  let toolId: string;
  let locationId: string;
  let sabelo: string;
  let thabo: string;
  let forklift: string;

  const recipient = async (name: string, type: string) => {
    const r = await api<{ id: string }>('POST', '/recipients', { name: `${name} ${run}`, type });
    expect(r.status).toBe(201);
    return r.body.id;
  };
  const issueTo = async (recipientId: string, quantity = 2) => {
    const r = await api<{ issueId: string; transactionIds: string[] }>('POST', '/inventory-issues', { recipientId, lines: [{ materialId, locationId, quantity }] });
    expect(r.status).toBe(201);
    return r.body;
  };
  const confirm = <T = Receipt>(slipId: string, body: unknown, key?: string, as = api) =>
    as<T>('POST', `/slips/${slipId}/confirmation`, body, key ? { 'idempotency-key': key } : undefined);
  const slip = async (slipId: string) => (await api<Slip[]>('GET', `/inventory-issues?materialId=${materialId}&limit=200`)).body.find((s) => s.id === slipId)!;

  let users = 0;
  async function newUser(role: string) {
    const email = `it-${role.toLowerCase()}-rc-${++users}-${run}@example.com`;
    const password = `${role.toLowerCase()}-${run}-pass`;
    expect((await api('POST', '/users', { email, name: `IT ${role} ${run}`, password, roleNames: [role], mustChangePassword: false })).status).toBe(201);
    return client(server.port, await login(server.port, email, password));
  }

  beforeAll(async () => {
    server = await startServer();
    api = client(server.port, await login(server.port, ADMIN_EMAIL, requireAdminPassword()));
    const location = await api<{ id: string }>('POST', '/locations', { name: `IT receipt rack ${run}`, type: 'RACK' });
    expect(location.status).toBe(201);
    locationId = location.body.id;
    const material = await api<{ id: string }>('POST', '/materials', { sku: `IT-RC-${run}`, name: `Receipt disc ${run}`, category: 'CONSUMABLES', unitOfMeasure: 'each' });
    expect(material.status).toBe(200);
    materialId = material.body.id;
    expect((await api('POST', '/inventory-adjustments', { materialId, locationId, quantity: 100, reasonCode: 'COUNT_VARIANCE' })).status).toBe(201);
    const tool = await api<{ id: string }>('POST', '/materials', { sku: `IT-RC-TOOL-${run}`, name: `Receipt drill ${run}`, category: 'TOOLS', unitOfMeasure: 'each' });
    toolId = tool.body.id;
    expect((await api('POST', '/inventory-adjustments', { materialId: toolId, locationId, quantity: 2, reasonCode: 'COUNT_VARIANCE' })).status).toBe(201);

    sabelo = await recipient('Sabelo', 'WORKER');
    thabo = await recipient('Thabo', 'WORKER');
    forklift = await recipient('Forklift', 'MACHINE');
    expect((await api('PUT', `/recipients/${sabelo}/pin`, { pin: '2580' })).status).toBe(200);
    expect((await api('PUT', `/recipients/${thabo}/pin`, { pin: '1470' })).status).toBe(200);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('keeps the PIN as a hash that no read returns', async () => {
    const row = await prisma.recipient.findUniqueOrThrow({ where: { id: sabelo } });
    expect(row.pinHash).toMatch(/^\$2[aby]\$/);
    const one = await api<Recipient>('GET', `/recipients/${sabelo}`);
    expect(one.body).toMatchObject({ pinSet: true, pinLocked: false });
    expect(one.body).not.toHaveProperty('pinHash');
    const list = await api<Recipient[]>('GET', `/recipients?q=${run}`);
    expect(JSON.stringify(list.body)).not.toContain(row.pinHash!);
    const audit = await prisma.auditLogEntry.findMany({ where: { entityId: sabelo } });
    expect(JSON.stringify(audit)).not.toContain(row.pinHash!);
    expect((await api<Err>('PUT', `/recipients/${forklift}/pin`, { pin: '2580' })).status).toBe(400);
    expect((await api<Err>('PUT', `/recipients/${sabelo}/pin`, { pin: '4719' })).status).toBe(409);
  });

  it('confirms an issue with the right PIN, without moving stock', async () => {
    const { issueId } = await issueTo(sabelo);
    const before = await ledgerAndBalance(materialId, locationId);
    const res = await confirm(issueId, { method: 'PIN', signerId: sabelo, pin: '2580' }, randomUUID());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ method: 'PIN', signerName: `Sabelo ${run}`, collectedFor: false, changed: false });
    expect(await ledgerAndBalance(materialId, locationId)).toEqual(before);
    expect((await slip(issueId)).receipt).toMatchObject({ method: 'PIN' });
  });

  it('counts a wrong PIN though nothing is recorded, then locks the PIN', async () => {
    const { issueId } = await issueTo(thabo);
    for (const left of [4, 3, 2, 1]) {
      const wrong = await confirm<Err>(issueId, { method: 'PIN', signerId: thabo, pin: '9999' });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error).toMatchObject({ code: 'PIN_MISMATCH', details: { triesLeft: left } });
    }
    expect(await prisma.receiptConfirmation.count({ where: { slipId: issueId } })).toBe(0);
    const locked = await confirm<Err>(issueId, { method: 'PIN', signerId: thabo, pin: '9999' });
    expect(locked.status).toBe(423);
    expect((await confirm<Err>(issueId, { method: 'PIN', signerId: thabo, pin: '1470' })).body.error.code).toBe('PIN_LOCKED');
    expect((await api<Recipient>('GET', `/recipients/${thabo}`)).body).toMatchObject({ pinLocked: true, pinFailedTries: 5 });

    // Locked, they can still sign; and a store controller unlocks the PIN.
    expect((await confirm(issueId, { method: 'SIGNATURE', signerId: thabo, image: { contentType: 'image/png', data: PNG } })).status).toBe(201);
    expect((await api('POST', `/recipients/${thabo}/pin/unlock`)).status).toBe(200);
    expect((await api<Recipient>('GET', `/recipients/${thabo}`)).body).toMatchObject({ pinLocked: false, pinFailedTries: 0 });
  });

  it('lets only the recipient confirm their own slip, and the person collecting confirm for a machine', async () => {
    const own = await issueTo(sabelo);
    const forSomeoneElse = await confirm<Err>(own.issueId, { method: 'PIN', signerId: thabo, pin: '1470' });
    expect(forSomeoneElse.status).toBe(422);
    expect(forSomeoneElse.body.error.code).toBe('SIGNER_NOT_RECIPIENT');

    const machine = await issueTo(forklift);
    const byMachine = await confirm<Err>(machine.issueId, { method: 'SIGNATURE', signerId: forklift, image: { contentType: 'image/png', data: PNG } });
    expect(byMachine.status).toBe(400);
    const collected = await confirm(machine.issueId, { method: 'PIN', signerId: thabo, pin: '1470' });
    expect(collected.status).toBe(201);
    expect(collected.body).toMatchObject({ signerName: `Thabo ${run}`, collectedFor: true });
  });

  it('confirms a slip once, and replays a retry instead of recording it twice', async () => {
    const { issueId } = await issueTo(sabelo);
    const key = randomUUID();
    const first = await confirm(issueId, { method: 'PIN', signerId: sabelo, pin: '2580' }, key);
    const retry = await confirm(issueId, { method: 'PIN', signerId: sabelo, pin: '2580' }, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers.get('idempotency-replayed')).toBe('true');
    expect(await prisma.receiptConfirmation.count({ where: { slipId: issueId } })).toBe(1);
    // The PIN is not in the stored request.
    const stored = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
    expect(JSON.stringify(stored)).not.toContain('2580');

    const again = await confirm<Err>(issueId, { method: 'SIGNATURE', signerId: sabelo, image: { contentType: 'image/png', data: PNG } }, randomUUID());
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_CONFIRMED');
  });

  it('keeps one confirmation when two arrive at the same moment', async () => {
    const { issueId } = await issueTo(sabelo);
    const both = await Promise.all([1, 2].map(() => confirm(issueId, { method: 'SIGNATURE', signerId: sabelo, image: { contentType: 'image/png', data: PNG } }, randomUUID())));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.receiptConfirmation.count({ where: { slipId: issueId, method: { not: 'NONE' } } })).toBe(1);
  });

  it('records why a slip was not confirmed, lists it as not confirmed, and lets a signed slip close it later', async () => {
    const { issueId } = await issueTo(sabelo);
    const noNote = await confirm<Err>(issueId, { method: 'NONE', reason: 'DISPUTED' });
    expect(noNote.status).toBe(400);
    expect((await confirm(issueId, { method: 'NONE', reason: 'LEFT' })).body).toMatchObject({ method: 'NONE', reason: 'LEFT' });

    const unconfirmed = await api<Slip[]>('GET', `/inventory-issues?materialId=${materialId}&receipt=unconfirmed&limit=200`);
    expect(unconfirmed.body.map((s) => s.id)).toContain(issueId);

    const paper = await confirm(issueId, { method: 'PAPER', signerId: sabelo, image: { contentType: 'image/png', data: PNG } });
    expect(paper.status).toBe(201);
    expect(paper.body).toMatchObject({ method: 'PAPER', hasImage: true });
    const confirmed = await api<Slip[]>('GET', `/inventory-issues?materialId=${materialId}&receipt=confirmed&limit=200`);
    expect(confirmed.body.map((s) => s.id)).toContain(issueId);
    expect((await api<Slip[]>('GET', `/inventory-issues?materialId=${materialId}&receipt=unconfirmed&limit=200`)).body.map((s) => s.id)).not.toContain(issueId);

    const image = await fetch(`http://127.0.0.1:${server.port}/api/v1/slips/${issueId}/confirmation/image`, {
      headers: { authorization: `Bearer ${await login(server.port, ADMIN_EMAIL, requireAdminPassword())}` },
    });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await image.arrayBuffer()).equals(Buffer.from(PNG, 'base64'))).toBe(true);
  });

  it('refuses an image that is not what it says', async () => {
    const { issueId } = await issueTo(sabelo);
    const fake = await confirm<Err>(issueId, { method: 'SIGNATURE', signerId: sabelo, image: { contentType: 'image/png', data: Buffer.from('not a picture').toString('base64') } });
    expect(fake.status).toBe(400);
    expect(await prisma.receiptConfirmation.count({ where: { slipId: issueId } })).toBe(0);
  });

  it('shows a slip as changed when a line is reversed after it was confirmed', async () => {
    const { issueId, transactionIds } = await issueTo(sabelo);
    expect((await confirm(issueId, { method: 'PIN', signerId: sabelo, pin: '2580' })).status).toBe(201);
    expect((await slip(issueId)).receipt).toMatchObject({ changed: false });
    expect((await api('POST', `/inventory-transactions/${transactionIds[0]}/reversal`, { reason: 'Wrong item' })).status).toBe(201);
    expect((await slip(issueId)).receipt).toMatchObject({ method: 'PIN', changed: true });
  });

  it('confirms a tool loan slip, which needs checkout:tool, and shows it on the open loan', async () => {
    const out = await api<{ slipId: string }>('POST', '/tools/check-out', { recipientId: sabelo, lines: [{ materialId: toolId, locationId, quantity: 1 }] });
    expect(out.status).toBe(201);
    const viewer = await newUser('VIEWER');
    expect((await confirm(out.body.slipId, { method: 'PIN', signerId: sabelo, pin: '2580' }, undefined, viewer)).status).toBe(403);
    const technician = await newUser('TECHNICIAN');
    expect((await confirm(out.body.slipId, { method: 'PIN', signerId: sabelo, pin: '2580' }, undefined, technician)).status).toBe(201);
    const tools = await api<Array<{ materialId: string; loans: Array<{ slipId: string; receipt: Receipt | null }> }>>('GET', '/tools');
    const loan = tools.body.find((t) => t.materialId === toolId)!.loans.find((l) => l.slipId === out.body.slipId)!;
    expect(loan.receipt).toMatchObject({ method: 'PIN', signerName: `Sabelo ${run}` });
  });

  it('keeps the database rules even when written past the API', async () => {
    const { issueId } = await issueTo(sabelo);
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    // A NONE row names nobody; a confirmation names who confirmed.
    await expect(prisma.receiptConfirmation.create({ data: { slipId: issueId, slipKind: 'ISSUE', method: 'NONE', capturedById: admin.id } })).rejects.toThrow();
    await expect(prisma.receiptConfirmation.create({ data: { slipId: issueId, slipKind: 'ISSUE', method: 'PIN', capturedById: admin.id, linesFingerprint: 'x' } })).rejects.toThrow();
    await prisma.receiptConfirmation.create({ data: { slipId: issueId, slipKind: 'ISSUE', method: 'PIN', signerId: sabelo, capturedById: admin.id, linesFingerprint: 'x' } });
    await expect(prisma.receiptConfirmation.create({ data: { slipId: issueId, slipKind: 'ISSUE', method: 'PAPER', signerId: sabelo, capturedById: admin.id, linesFingerprint: 'x' } })).rejects.toThrow();
  });

  it('counts the slips of the last 30 days nobody confirmed, leaving out confirmed and fully reversed ones', async () => {
    type Summary = { issues: number; loans: number; disputed: number; days: number };
    const before = (await api<Summary>('GET', '/slips/unconfirmed/summary')).body;
    const waiting = await issueTo(sabelo);
    const disputed = await issueTo(sabelo);
    expect((await confirm(disputed.issueId, { method: 'NONE', reason: 'DISPUTED', note: 'Got 1' })).status).toBe(201);
    const confirmed = await issueTo(sabelo);
    expect((await confirm(confirmed.issueId, { method: 'PIN', signerId: sabelo, pin: '2580' })).status).toBe(201);
    const reversed = await issueTo(sabelo);
    expect((await api('POST', `/inventory-transactions/${reversed.transactionIds[0]}/reversal`, { reason: 'Never left' })).status).toBe(201);
    const after = (await api<Summary>('GET', '/slips/unconfirmed/summary')).body;
    expect(after.days).toBe(30);
    expect(after.issues - before.issues).toBe(2);
    expect(after.disputed - before.disputed).toBe(1);
    expect(waiting.issueId).toBeTruthy();
    // A slip older than 30 days isn't counted.
    await prisma.inventoryTransaction.updateMany({ where: { issueId: waiting.issueId }, data: { postedAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect((await api<Summary>('GET', '/slips/unconfirmed/summary')).body.issues - before.issues).toBe(1);
  });

  it('removes a signature past its keep period and keeps the record that the slip was signed', async () => {
    const { issueId } = await issueTo(sabelo);
    expect((await confirm(issueId, { method: 'SIGNATURE', signerId: sabelo, image: { contentType: 'image/png', data: PNG } })).status).toBe(201);
    await prisma.receiptConfirmation.updateMany({ where: { slipId: issueId }, data: { confirmedAt: new Date(Date.now() - 25 * 31 * 86_400_000) } });
    const { pruneReceiptImages } = await import('../src/modules/inventory/receipt-check.js');
    expect(await pruneReceiptImages()).toBeGreaterThanOrEqual(1);
    expect(await prisma.receiptImage.count({ where: { confirmation: { slipId: issueId } } })).toBe(0);
    expect((await slip(issueId)).receipt).toMatchObject({ method: 'SIGNATURE', hasImage: false, imageRemoved: true });
    expect((await api('GET', `/slips/${issueId}/confirmation/image`)).status).toBe(404);
  });

  it('reports this run’s slips in check:receipts, with nothing broken by the API', async () => {
    const { checkReceipts } = await import('../src/modules/inventory/receipt-check.js');
    const report = await checkReceipts(prisma);
    const mine = new Set((await prisma.inventoryTransaction.findMany({ where: { materialId: { in: [materialId, toolId] }, issueId: { not: null } }, select: { issueId: true } })).map((t) => t.issueId!));
    expect(report.slips).toBeGreaterThanOrEqual(mine.size);
    // The reversal earlier made a confirmed slip read as changed.
    expect(report.changedAfter.some((id) => mine.has(id))).toBe(true);
    expect(report.disputed.some((id) => mine.has(id))).toBe(true);
    expect(report.wrongSigner.filter((id) => mine.has(id))).toEqual([]);
    expect(report.orphaned).toEqual([]);
  });

  // The edge cases fixed after review (E1 to E8).
  it('stops counting a tool loan once every tool is back (E1)', async () => {
    type Summary = { loans: number };
    const before = (await api<Summary>('GET', '/slips/unconfirmed/summary')).body.loans;
    const out = await api<{ slipId: string; loanIds: string[] }>('POST', '/tools/check-out', { recipientId: thabo, lines: [{ materialId: toolId, locationId, quantity: 1 }] });
    expect(out.status).toBe(201);
    expect((await api<Summary>('GET', '/slips/unconfirmed/summary')).body.loans).toBe(before + 1);
    expect((await api('POST', '/tools/check-in', { lines: [{ loanId: out.body.loanIds[0], quantity: 1, condition: 'GOOD' }] })).status).toBe(201);
    expect((await api<Summary>('GET', '/slips/unconfirmed/summary')).body.loans).toBe(before);
  });

  it('lists disputed slips of any age, on their own filter (E2)', async () => {
    const { issueId } = await issueTo(sabelo);
    expect((await confirm(issueId, { method: 'NONE', reason: 'DISPUTED', note: 'Got 1, not 2' })).status).toBe(201);
    await prisma.inventoryTransaction.updateMany({ where: { issueId }, data: { postedAt: new Date(Date.now() - 60 * 86_400_000) } });
    const summary = (await api<{ disputed: number; oldestDisputedAt: string | null }>('GET', '/slips/unconfirmed/summary')).body;
    expect(summary.disputed).toBeGreaterThanOrEqual(1);
    expect(summary.oldestDisputedAt).not.toBeNull();
    const disputed = await api<Slip[]>('GET', `/inventory-issues?materialId=${materialId}&receipt=disputed&limit=200`);
    expect(disputed.body.map((s) => s.id)).toContain(issueId);
    expect(disputed.body.every((s) => s.receipt?.reason === 'DISPUTED')).toBe(true);
  });

  it('takes the paper slip of someone who has since left, and nothing else from them (E4)', async () => {
    const leaver = await recipient('Leaver', 'WORKER');
    const { issueId } = await issueTo(leaver);
    expect((await api('PATCH', `/recipients/${leaver}`, { active: false })).status).toBe(200);
    const signed = await confirm<Err>(issueId, { method: 'SIGNATURE', signerId: leaver, image: { contentType: 'image/png', data: PNG } });
    expect(signed.status).toBe(400);
    expect(signed.body.error.message).toMatch(/has left \(inactive\)/);
    const paper = await confirm(issueId, { method: 'PAPER', signerId: leaver, image: { contentType: 'image/png', data: PNG } });
    expect(paper.status).toBe(201);
    expect(paper.body).toMatchObject({ method: 'PAPER', signerName: `Leaver ${run}` });
  });

  it('refuses to confirm a slip with every line reversed, before any PIN is tried (E5)', async () => {
    const { issueId, transactionIds } = await issueTo(sabelo);
    expect((await api('POST', `/inventory-transactions/${transactionIds[0]}/reversal`, { reason: 'Never left' })).status).toBe(201);
    const tries = (await prisma.recipient.findUniqueOrThrow({ where: { id: sabelo } })).pinFailedTries;
    const res = await confirm<Err>(issueId, { method: 'PIN', signerId: sabelo, pin: '9999' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Every line on this slip was reversed, so there is nothing to confirm.');
    expect((await prisma.recipient.findUniqueOrThrow({ where: { id: sabelo } })).pinFailedTries).toBe(tries);
  });

  it('says how often a PIN was unlocked in 30 days (E6), and how many images a keep period would remove (E8)', async () => {
    const lockable = await recipient('Locker', 'WORKER');
    expect((await api('PUT', `/recipients/${lockable}/pin`, { pin: '4719' })).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      await prisma.recipient.update({ where: { id: lockable }, data: { pinFailedTries: 5, pinLockedAt: new Date() } });
      expect((await api('POST', `/recipients/${lockable}/pin/unlock`)).status).toBe(200);
    }
    expect((await api<{ pinUnlocks30d: number }>('GET', `/recipients/${lockable}`)).body.pinUnlocks30d).toBe(3);

    const { issueId } = await issueTo(sabelo);
    expect((await confirm(issueId, { method: 'SIGNATURE', signerId: sabelo, image: { contentType: 'image/png', data: PNG } })).status).toBe(201);
    await prisma.receiptConfirmation.updateMany({ where: { slipId: issueId }, data: { confirmedAt: new Date(Date.now() - 13 * 31 * 86_400_000) } });
    const at12 = await api<{ count: number }>('GET', '/slips/images/past-keep?months=12');
    expect(at12.status).toBe(200);
    expect(at12.body.count).toBeGreaterThanOrEqual(1);
    expect((await api<{ count: number }>('GET', '/slips/images/past-keep?months=0')).body.count).toBe(0);
    expect((await api('GET', '/slips/images/past-keep?months=abc')).status).toBe(400);
  });

  it('refuses an unknown slip, and a viewer setting a PIN', async () => {
    expect((await confirm(randomUUID(), { method: 'NONE', reason: 'LEFT' })).status).toBe(404);
    const viewer = await newUser('VIEWER');
    expect((await viewer('POST', `/recipients/${sabelo}/pin/reset`, { reason: 'x' })).status).toBe(403);
  });
});
