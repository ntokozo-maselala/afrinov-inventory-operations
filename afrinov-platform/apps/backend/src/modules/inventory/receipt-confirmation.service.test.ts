// Proof of receipt (ADR-034): who may confirm a slip, what a confirmation
// covers, and what it refuses. The real database's rules (the partial unique
// index, the CHECKs, PIN counting under a refusal) are in
// integration/receipts.real-http.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Tx = { id: string; issueId: string; type: 'ISSUE' | 'LOAN'; quantity: Prisma.Decimal; recipientId: string | null; reversed: boolean };
type Conf = { id: string; slipId: string; method: string; signerId: string | null; reason: string | null; note: string | null; linesFingerprint: string | null; capturedById: string; confirmedAt: Date; imageRemovedAt: Date | null; image?: { size: number } | null };

const people: Record<string, { name: string; type: string; active: boolean }> = {
  sabelo: { name: 'Sabelo Mkhize', type: 'WORKER', active: true },
  thabo: { name: 'Thabo Ndlovu', type: 'WORKER', active: true },
  kts: { name: 'KTS Engineering', type: 'CONTRACTOR', active: true },
  gone: { name: 'Left Company', type: 'WORKER', active: false },
  forklift: { name: 'Forklift 3', type: 'MACHINE', active: true },
};
const db = { ledger: [] as Tx[], confirmations: [] as Conf[], locks: [] as string[] };
let seq = 0;

const client = {
  $executeRaw: vi.fn(async (_s: TemplateStringsArray, key: string) => { db.locks.push(key); return 0; }),
  inventoryTransaction: {
    findMany: async ({ where }: { where: { issueId: string } }) => db.ledger.filter((t) => t.issueId === where.issueId).map((t) => ({
      id: t.id, type: t.type, quantity: t.quantity, recipientId: t.recipientId,
      recipient: t.recipientId ? { name: people[t.recipientId]!.name, type: people[t.recipientId]!.type } : null,
      reversedBy: t.reversed ? { id: `rev-${t.id}` } : null,
    })),
  },
  recipient: { findUnique: async ({ where }: { where: { id: string } }) => people[where.id] ?? null },
  receiptConfirmation: {
    findFirst: async ({ where }: { where: { slipId: string } }) => db.confirmations.find((c) => c.slipId === where.slipId && c.method !== 'NONE') ?? null,
    findMany: async ({ where }: { where: { slipId: { in: string[] }; method?: unknown } }) =>
      db.confirmations.filter((c) => where.slipId.in.includes(c.slipId) && (!where.method || c.method !== 'NONE')).map(withNames),
    create: async ({ data }: { data: Partial<Omit<Conf, 'image'>> & Pick<Conf, 'slipId' | 'method' | 'capturedById'> & { image?: { create: { size: number } } } }) => {
      const { image, ...rest } = data;
      const row: Conf = { signerId: null, reason: null, note: null, linesFingerprint: null, ...rest, id: `c-${++seq}`, confirmedAt: new Date(Date.now() + seq), imageRemovedAt: null, image: image ? { size: image.create.size } : null };
      db.confirmations.push(row);
      return withNames(row);
    },
  },
};
function withNames(c: Conf) {
  return { ...c, image: c.image ?? null, signer: c.signerId ? { name: people[c.signerId]!.name } : null, capturedBy: { name: 'Vusi Khumalo' } };
}
vi.mock('../../shared/db.js', () => ({ prisma: { ...client, $transaction: async (fn: (t: typeof client) => unknown) => fn(client) } }));

const { ReceiptConfirmationService, slipFingerprint, checkSigner, checkImage, loadSlip } = await import('./receipt-confirmation.service.js');

const D = (n: number) => new Prisma.Decimal(n);
const issue = (issueId: string, recipientId: string | null, lines: number[], type: 'ISSUE' | 'LOAN' = 'ISSUE') => {
  for (const q of lines) db.ledger.push({ id: `tx-${++seq}`, issueId, type, quantity: D(-q), recipientId, reversed: false });
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

beforeEach(() => {
  db.ledger.length = 0;
  db.confirmations.length = 0;
  db.locks.length = 0;
  seq = 0;
});

describe('slipFingerprint', () => {
  it('is the same whatever order the lines come in, and however the quantity is written', () => {
    expect(slipFingerprint([{ id: 'a', quantity: '-2.0000' }, { id: 'b', quantity: D(-1) }]))
      .toBe(slipFingerprint([{ id: 'b', quantity: '-1' }, { id: 'a', quantity: '-2' }]));
  });

  it('changes when a line drops out', () => {
    expect(slipFingerprint([{ id: 'a', quantity: '-2' }])).not.toBe(slipFingerprint([{ id: 'a', quantity: '-2' }, { id: 'b', quantity: '-1' }]));
  });
});

describe('who may confirm a slip', () => {
  it('lets a worker or contractor confirm only their own slip: nobody confirms for them', async () => {
    issue('s1', 'sabelo', [4]);
    const slip = await loadSlip('s1');
    await expect(checkSigner(slip, 'sabelo')).resolves.toEqual({ name: 'Sabelo Mkhize' });
    await expect(checkSigner(slip, 'thabo')).rejects.toMatchObject({ code: 'SIGNER_NOT_RECIPIENT', message: 'Only Sabelo Mkhize can confirm this slip.' });
  });

  it('has a person who collected confirm for a machine or site, never the machine itself', async () => {
    issue('s2', 'forklift', [1]);
    const slip = await loadSlip('s2');
    await expect(checkSigner(slip, 'thabo')).resolves.toEqual({ name: 'Thabo Ndlovu' });
    await expect(checkSigner(slip, 'kts')).resolves.toEqual({ name: 'KTS Engineering' });
    await expect(checkSigner(slip, 'forklift')).rejects.toThrow(/choose the person who collected/);
  });

  it('refuses an inactive signer, and a slip that does not exist', async () => {
    issue('s3', 'forklift', [1]);
    await expect(checkSigner(await loadSlip('s3'), 'gone')).rejects.toThrow(/inactive/);
    await expect(loadSlip('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('knows a tool loan slip from an issue slip', async () => {
    issue('l1', 'kts', [1, 1], 'LOAN');
    expect(await loadSlip('l1')).toMatchObject({ kind: 'LOAN', recipientName: 'KTS Engineering' });
  });
});

describe('checkImage', () => {
  it('takes a PNG signature and a JPEG photo of a signed slip', () => {
    expect(() => checkImage('SIGNATURE', 'image/png', PNG)).not.toThrow();
    expect(() => checkImage('PAPER', 'image/jpeg', JPEG)).not.toThrow();
  });

  it('refuses a signature that is not a PNG, an image that is not what it says, or one too large', () => {
    expect(() => checkImage('SIGNATURE', 'image/jpeg', JPEG)).toThrow(/PNG/);
    expect(() => checkImage('PAPER', 'image/png', JPEG)).toThrow(/not a valid picture/);
    expect(() => checkImage('SIGNATURE', 'image/png', Buffer.concat([PNG, Buffer.alloc(200 * 1024)]))).toThrow(/too large/);
    expect(() => checkImage('PAPER', 'image/jpeg', Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]))).toThrow(/over 5 MB/);
    expect(() => checkImage('PAPER', 'image/jpeg', Buffer.alloc(0))).toThrow(/empty/);
  });
});

describe('ReceiptConfirmationService.confirm', () => {
  it('records a PIN confirmation with a fingerprint of the slip, holding the slip while it does', async () => {
    issue('s1', 'sabelo', [4, 2]);
    const summary = await ReceiptConfirmationService.confirm({ slipId: 's1', method: 'PIN', signerId: 'sabelo', actorId: 'u-vusi' });
    expect(summary).toMatchObject({ method: 'PIN', signerName: 'Sabelo Mkhize', collectedFor: false, changed: false, capturedByName: 'Vusi Khumalo', hasImage: false });
    expect(db.confirmations[0]).toMatchObject({ slipKind: 'ISSUE', capturedById: 'u-vusi', linesFingerprint: slipFingerprint([{ id: 'tx-1', quantity: '-4' }, { id: 'tx-2', quantity: '-2' }]) });
    expect(db.locks).toEqual(['afrinov:receipt:s1']);
  });

  it('says when the person collected for a machine', async () => {
    issue('s2', 'forklift', [1]);
    expect(await ReceiptConfirmationService.confirm({ slipId: 's2', method: 'SIGNATURE', signerId: 'thabo', image: { contentType: 'image/png', data: PNG }, actorId: 'u' }))
      .toMatchObject({ signerName: 'Thabo Ndlovu', collectedFor: true, hasImage: true });
  });

  it('confirms a slip once: a second confirmation is refused', async () => {
    issue('s1', 'sabelo', [4]);
    await ReceiptConfirmationService.confirm({ slipId: 's1', method: 'PIN', signerId: 'sabelo', actorId: 'u' });
    await expect(ReceiptConfirmationService.confirm({ slipId: 's1', method: 'PIN', signerId: 'sabelo', actorId: 'u' })).rejects.toMatchObject({ code: 'ALREADY_CONFIRMED' });
    await expect(ReceiptConfirmationService.confirm({ slipId: 's1', method: 'NONE', reason: 'LEFT', actorId: 'u' })).rejects.toMatchObject({ code: 'ALREADY_CONFIRMED' });
  });

  it('records why a slip was not confirmed, which a real confirmation can follow', async () => {
    issue('s1', 'sabelo', [4]);
    expect(await ReceiptConfirmationService.confirm({ slipId: 's1', method: 'NONE', reason: 'LEFT', actorId: 'u' })).toMatchObject({ method: 'NONE', reason: 'LEFT', signerId: null });
    await ReceiptConfirmationService.confirm({ slipId: 's1', method: 'PIN', signerId: 'sabelo', actorId: 'u' });
    expect((await ReceiptConfirmationService.forSlips([{ id: 's1', recipientId: 'sabelo', lines: [{ id: 'tx-1', quantity: '-4', reversed: false }] }])).get('s1'))
      .toMatchObject({ method: 'PIN', changed: false });
  });

  it('needs a note when they say the slip is wrong, or for Other', async () => {
    issue('s1', 'sabelo', [4]);
    await expect(ReceiptConfirmationService.confirm({ slipId: 's1', method: 'NONE', reason: 'DISPUTED', note: '  ', actorId: 'u' })).rejects.toThrow(/what they say is wrong/);
    await expect(ReceiptConfirmationService.confirm({ slipId: 's1', method: 'NONE', reason: 'OTHER', actorId: 'u' })).rejects.toThrow(/what happened/);
    await expect(ReceiptConfirmationService.confirm({ slipId: 's1', method: 'NONE', reason: 'DISPUTED', note: 'Got 3, not 4', actorId: 'u' })).resolves.toMatchObject({ note: 'Got 3, not 4' });
  });

  it('turns a confirmation made at the same moment elsewhere into ALREADY_CONFIRMED', async () => {
    issue('s1', 'sabelo', [4]);
    const create = vi.spyOn(client.receiptConfirmation, 'create').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    await expect(ReceiptConfirmationService.confirm({ slipId: 's1', method: 'PIN', signerId: 'sabelo', actorId: 'u' })).rejects.toMatchObject({ code: 'ALREADY_CONFIRMED' });
    create.mockRestore();
  });
});

describe('ReceiptConfirmationService.forSlips', () => {
  it('marks a confirmed slip changed once one of its lines is reversed', async () => {
    issue('s1', 'sabelo', [4, 2]);
    await ReceiptConfirmationService.confirm({ slipId: 's1', method: 'PIN', signerId: 'sabelo', actorId: 'u' });
    const lines = [{ id: 'tx-1', quantity: '-4', reversed: false }, { id: 'tx-2', quantity: '-2', reversed: false }];
    expect((await ReceiptConfirmationService.forSlips([{ id: 's1', recipientId: 'sabelo', lines }])).get('s1')!.changed).toBe(false);
    lines[1]!.reversed = true;
    expect((await ReceiptConfirmationService.forSlips([{ id: 's1', recipientId: 'sabelo', lines }])).get('s1')!.changed).toBe(true);
  });

  it('leaves out a slip with nothing recorded, and shows the latest reason when it has only reasons', async () => {
    issue('s1', 'sabelo', [4]);
    issue('s2', 'thabo', [1]);
    await ReceiptConfirmationService.confirm({ slipId: 's1', method: 'NONE', reason: 'LEFT', actorId: 'u' });
    await ReceiptConfirmationService.confirm({ slipId: 's1', method: 'NONE', reason: 'NO_SCREEN', actorId: 'u' });
    const out = await ReceiptConfirmationService.forSlips([
      { id: 's1', recipientId: 'sabelo', lines: [] }, { id: 's2', recipientId: 'thabo', lines: [] },
    ]);
    expect(out.get('s1')).toMatchObject({ method: 'NONE', reason: 'NO_SCREEN', changed: false });
    expect(out.has('s2')).toBe(false);
  });
});
