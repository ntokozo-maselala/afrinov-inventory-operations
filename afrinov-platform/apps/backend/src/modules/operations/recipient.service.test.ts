// Unit tests for RecipientService ("Issued To" list).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Recipient = {
  id: string; name: string; type: string; notes: string | null; active: boolean; createdAt: Date; updatedAt: Date;
  pinHash: string | null; pinSetAt: Date | null; pinFailedTries: number; pinLockedAt: Date | null;
};
type AuditRow = { actorId: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown };

const db = { recipients: new Map<string, Recipient>(), audit: [] as AuditRow[] };
let seq = 0;

type NameFilter = { equals?: string; contains?: string; mode?: string };
function nameMatches(name: string, f: NameFilter): boolean {
  const n = name.toLowerCase();
  if (f.equals !== undefined) return n === f.equals.toLowerCase();
  if (f.contains !== undefined) return n.includes(f.contains.toLowerCase());
  return true;
}

function makePrisma(): unknown {
  const tx = {
    // The row hold a PIN change takes.
    $queryRaw: async () => [],
    recipient: {
      findUnique: async ({ where }: { where: { id: string } }) => db.recipients.get(where.id) ?? null,
      findFirst: async ({ where }: { where: { name: NameFilter; NOT?: { id: string } } }) =>
        [...db.recipients.values()].find((r) => nameMatches(r.name, where.name) && r.id !== where.NOT?.id) ?? null,
      findMany: async ({ where }: { where: { type?: string; active?: boolean; name?: NameFilter } }) =>
        [...db.recipients.values()].filter((r) =>
          (where.type === undefined || r.type === where.type)
          && (where.active === undefined || r.active === where.active)
          && (where.name === undefined || nameMatches(r.name, where.name))),
      create: async ({ data }: { data: Omit<Recipient, 'id' | 'active' | 'createdAt' | 'updatedAt'> }) => {
        // Mirrors the unique index on lower(btrim(name)).
        if ([...db.recipients.values()].some((r) => r.name.toLowerCase() === data.name.toLowerCase())) {
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        }
        const r: Recipient = {
          ...data, id: `rcp-${++seq}`, active: true, createdAt: new Date(), updatedAt: new Date(),
          pinHash: null, pinSetAt: null, pinFailedTries: 0, pinLockedAt: null,
        };
        db.recipients.set(r.id, r);
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Recipient> }) => {
        const r = { ...db.recipients.get(where.id)!, ...data, updatedAt: new Date() };
        db.recipients.set(r.id, r);
        return r;
      },
    },
    auditLogEntry: {
      create: async ({ data }: { data: AuditRow }) => { db.audit.push(data); return data; },
      // Unlocks in the last 30 days, per recipient (edge case E6).
      groupBy: async () => Object.entries(db.audit.filter((a) => a.action === 'PIN_UNLOCK').reduce<Record<string, number>>((m, a) => ({ ...m, [a.entityId]: (m[a.entityId] ?? 0) + 1 }), {}))
        .map(([entityId, n]) => ({ entityId, _count: { _all: n } })),
    },
  };
  return { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
}

vi.mock('../../shared/db.js', () => ({ get prisma() { return makePrisma(); } }));

const { RecipientService } = await import('./recipient.service.js');

beforeEach(() => {
  db.recipients.clear();
  db.audit.length = 0;
  seq = 0;
});

describe('RecipientService', () => {
  it('creates a recipient with a tidied name and an audit entry', async () => {
    const r = await RecipientService.create({ name: '  Sabelo   Mkhize ', type: 'WORKER' }, 'admin');
    expect(r).toMatchObject({ name: 'Sabelo Mkhize', type: 'WORKER', active: true, notes: null });
    expect(db.audit).toEqual([expect.objectContaining({ action: 'CREATE', entityType: 'Recipient', entityId: r!.id })]);
  });

  it('allows each of the four types', async () => {
    for (const [name, type] of [['Vusi', 'WORKER'], ['Forklift', 'MACHINE'], ['Northam Platinum', 'SITE'], ['KTS', 'CONTRACTOR']] as const) {
      await RecipientService.create({ name, type }, 'admin');
    }
    expect((await RecipientService.list({ type: 'MACHINE' })).map((r) => r.name)).toEqual(['Forklift']);
  });

  it('refuses a name that already exists, ignoring case', async () => {
    await RecipientService.create({ name: 'Simngawe', type: 'WORKER' }, 'admin');
    await expect(RecipientService.create({ name: 'SIMNGAWE', type: 'CONTRACTOR' }, 'admin')).rejects.toThrow(/already exists/);
    expect(db.recipients.size).toBe(1);
  });

  it('refuses a blank name', async () => {
    await expect(RecipientService.create({ name: '   ', type: 'WORKER' }, 'admin')).rejects.toThrow(/Name is required/);
  });

  it('deactivates instead of deleting, and lists active recipients only on request', async () => {
    const r = await RecipientService.create({ name: 'Generator', type: 'MACHINE' }, 'admin');
    await RecipientService.update({ id: r!.id, active: false }, 'admin');
    expect(db.recipients.get(r!.id)?.active).toBe(false);
    expect(await RecipientService.list({ active: true })).toEqual([]);
    expect(await RecipientService.list({})).toHaveLength(1);
  });

  it('refuses renaming onto another recipient but allows changing the case of its own name', async () => {
    const a = await RecipientService.create({ name: 'Khotso', type: 'WORKER' }, 'admin');
    await RecipientService.create({ name: 'Tumelo', type: 'WORKER' }, 'admin');
    await expect(RecipientService.update({ id: a!.id, name: 'tumelo' }, 'admin')).rejects.toThrow(/already exists/);
    const renamed = await RecipientService.update({ id: a!.id, name: 'KHOTSO' }, 'admin');
    expect(renamed?.name).toBe('KHOTSO');
  });

  it('reports an unknown recipient as not found', async () => {
    await expect(RecipientService.update({ id: 'missing', active: false }, 'admin')).rejects.toThrow(/Recipient not found/);
    await expect(RecipientService.getById('missing')).rejects.toThrow(/Recipient not found/);
  });
});

describe('RecipientService counter PINs (ADR-034)', () => {
  const worker = async () => (await RecipientService.create({ name: 'Sabelo Mkhize', type: 'WORKER' }, 'admin'))!;

  it('sets a PIN as a hash, and never shows it in a read or the audit log', async () => {
    const r = await worker();
    const after = await RecipientService.setPin(r.id, '2580', 'store');
    expect(db.recipients.get(r.id)!.pinHash).toMatch(/^\$2[aby]\$10\$/);
    expect(after).toMatchObject({ pinSet: true, pinLocked: false });
    expect(after).not.toHaveProperty('pinHash');
    expect(await RecipientService.getById(r.id)).not.toHaveProperty('pinHash');
    expect((await RecipientService.list())[0]).not.toHaveProperty('pinHash');
    expect(JSON.stringify(db.audit)).not.toContain(db.recipients.get(r.id)!.pinHash!);
    expect(db.audit.at(-1)).toMatchObject({ action: 'PIN_SET', entityType: 'Recipient', entityId: r.id, actorId: 'store' });
  });

  it('refuses a PIN that is easy to guess', async () => {
    const r = await worker();
    for (const pin of ['1234', '0000', '9876', '1212', '123456', '0123']) {
      await expect(RecipientService.setPin(r.id, pin, 'store')).rejects.toMatchObject({ code: 'WEAK_PIN' });
    }
    await expect(RecipientService.setPin(r.id, '12a4', 'store')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.recipients.get(r.id)!.pinHash).toBeNull();
  });

  it('gives a machine or site no PIN: whoever collects for it confirms', async () => {
    const m = (await RecipientService.create({ name: 'Forklift 3', type: 'MACHINE' }, 'admin'))!;
    await expect(RecipientService.setPin(m.id, '2580', 'store')).rejects.toThrow(/whoever collects for it/);
  });

  it('replaces a PIN only after a reset with a reason, so it is never swapped quietly', async () => {
    const r = await worker();
    await RecipientService.setPin(r.id, '2580', 'store');
    await expect(RecipientService.setPin(r.id, '4719', 'store')).rejects.toMatchObject({ code: 'CONFLICT' });
    const reset = await RecipientService.resetPin(r.id, 'Forgot it', 'store');
    expect(reset).toMatchObject({ pinSet: false });
    expect(db.audit.at(-1)).toMatchObject({ action: 'PIN_RESET', after: expect.objectContaining({ reason: 'Forgot it' }) });
    await RecipientService.setPin(r.id, '4719', 'store');
    expect(db.recipients.get(r.id)!.pinHash).not.toBeNull();
  });

  it('unlocks a locked PIN, and says when there is nothing to unlock', async () => {
    const r = await worker();
    await RecipientService.setPin(r.id, '2580', 'store');
    await expect(RecipientService.unlockPin(r.id, 'store')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    db.recipients.set(r.id, { ...db.recipients.get(r.id)!, pinFailedTries: 5, pinLockedAt: new Date() });
    expect(await RecipientService.unlockPin(r.id, 'store')).toMatchObject({ pinLocked: false, pinFailedTries: 0, pinSet: true });
  });

  it('says how often each PIN was unlocked in the last 30 days (edge case E6)', async () => {
    const r = await worker();
    await RecipientService.setPin(r.id, '2580', 'store');
    for (let i = 0; i < 3; i++) {
      db.recipients.set(r.id, { ...db.recipients.get(r.id)!, pinFailedTries: 5, pinLockedAt: new Date() });
      await RecipientService.unlockPin(r.id, 'store');
    }
    expect((await RecipientService.list())[0]).toMatchObject({ pinUnlocks30d: 3 });
    expect(await RecipientService.getById(r.id)).toMatchObject({ pinUnlocks30d: 3 });
  });

  it('clears the PIN when a worker becomes a machine or site', async () => {
    const r = await worker();
    await RecipientService.setPin(r.id, '2580', 'store');
    expect(await RecipientService.update({ id: r.id, type: 'SITE' }, 'admin')).toMatchObject({ pinSet: false });
    expect(db.recipients.get(r.id)!.pinHash).toBeNull();
  });
});
