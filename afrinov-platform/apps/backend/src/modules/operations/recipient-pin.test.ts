// Counter PINs (ADR-034): what counts as easy to guess, and how wrong tries
// are counted and lock a PIN.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';

type Row = { id: string; name: string; pinHash: string | null; pinFailedTries: number; pinLockedAt: Date | null };
const db = { row: null as Row | null, holds: 0, audit: [] as Array<{ action: string }> };

const tx = {
  $queryRaw: async () => { db.holds++; return []; },
  recipient: {
    findUnique: async () => (db.row ? { ...db.row } : null),
    update: async ({ data }: { data: Partial<Row> }) => { db.row = { ...db.row!, ...data }; return db.row; },
  },
  auditLogEntry: { create: async ({ data }: { data: { action: string } }) => { db.audit.push(data); return data; } },
};
vi.mock('../../shared/db.js', () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }));
vi.mock('../settings/settings.service.js', () => ({ SettingsService: { getValue: async () => 3 } }));

const { isWeakPin, verifyPin, publicRecipient } = await import('./recipient-pin.js');

const HASH = bcrypt.hashSync('2580', 4);

beforeEach(() => {
  db.row = { id: 'r1', name: 'Sabelo Mkhize', pinHash: HASH, pinFailedTries: 0, pinLockedAt: null };
  db.holds = 0;
  db.audit.length = 0;
});

describe('isWeakPin', () => {
  it('flags runs, repeats and repeated pairs', () => {
    for (const pin of ['0000', '1111', '1234', '4321', '0123', '9876', '7890', '1212', '123456', '654321', '121212', '999999']) expect(isWeakPin(pin)).toBe(true);
  });

  it('accepts ordinary PINs', () => {
    for (const pin of ['2580', '1470', '4719', '8031', '102938', '1122']) expect(isWeakPin(pin)).toBe(false);
  });
});

describe('verifyPin', () => {
  it('accepts the right PIN and clears earlier wrong tries, holding the row while it checks', async () => {
    db.row!.pinFailedTries = 2;
    await expect(verifyPin('r1', '2580')).resolves.toBeUndefined();
    expect(db.row!.pinFailedTries).toBe(0);
    expect(db.holds).toBe(1);
  });

  it('counts a wrong PIN and says how many tries are left', async () => {
    await expect(verifyPin('r1', '1111')).rejects.toMatchObject({ code: 'PIN_MISMATCH', statusCode: 422, details: { triesLeft: 2 } });
    expect(db.row!.pinFailedTries).toBe(1);
  });

  it('locks after the set number of wrong tries, and then refuses even the right PIN', async () => {
    await expect(verifyPin('r1', '1111')).rejects.toMatchObject({ code: 'PIN_MISMATCH' });
    await expect(verifyPin('r1', '1111')).rejects.toMatchObject({ code: 'PIN_MISMATCH', details: { triesLeft: 1 } });
    await expect(verifyPin('r1', '1111')).rejects.toMatchObject({ code: 'PIN_LOCKED', statusCode: 423 });
    expect(db.row!.pinLockedAt).not.toBeNull();
    expect(db.audit).toEqual([expect.objectContaining({ action: 'PIN_LOCKED' })]);
    await expect(verifyPin('r1', '2580')).rejects.toMatchObject({ code: 'PIN_LOCKED' });
  });

  it('says when there is no PIN, or no such recipient', async () => {
    db.row!.pinHash = null;
    await expect(verifyPin('r1', '2580')).rejects.toMatchObject({ code: 'PIN_NOT_SET', message: 'Sabelo Mkhize has no PIN yet. They can sign instead.' });
    db.row = null;
    await expect(verifyPin('r1', '2580')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('publicRecipient', () => {
  it('drops the hash and says whether a PIN is set or locked', () => {
    const r = { id: 'r1', name: 'S', type: 'WORKER' as const, notes: null, active: true, createdAt: new Date(), updatedAt: new Date(), pinHash: 'x', pinSetAt: new Date(), pinFailedTries: 0, pinLockedAt: null };
    const out = publicRecipient(r);
    expect(out).not.toHaveProperty('pinHash');
    expect(out).toMatchObject({ pinSet: true, pinLocked: false });
  });
});
