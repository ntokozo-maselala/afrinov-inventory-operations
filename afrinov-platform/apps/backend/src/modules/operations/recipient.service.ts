// Recipients: the people and places stock is issued to — workers, machines,
// client sites and contractors. Most are not users who log in. A recipient is
// deactivated rather than deleted, so issue history keeps its name.
//
// Workers and contractors may have a counter PIN to confirm what they take
// (ADR-034). Every read and audit entry goes through publicRecipient, so the
// PIN's hash never leaves the server.
import { Prisma, type RecipientType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { PIN_PATTERN, hashPin, holdsPin, isWeakPin, publicRecipient } from './recipient-pin.js';

export const RECIPIENT_TYPES: RecipientType[] = ['WORKER', 'MACHINE', 'SITE', 'CONTRACTOR'];

export interface CreateRecipientInput {
  name: string;
  type: RecipientType;
  notes?: string;
}

export interface UpdateRecipientInput {
  id: string;
  name?: string;
  type?: RecipientType;
  notes?: string | null;
  active?: boolean;
}

const NO_PIN = { pinHash: null, pinSetAt: null, pinFailedTries: 0, pinLockedAt: null } as const;

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw Errors.validation('Name is required');
  return trimmed;
}

async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.recipient.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw Errors.conflict(`A recipient named "${clash.name}" already exists`);
}

// Two requests creating the same name at once: the unique index wins.
function rethrowNameClash(err: unknown, name: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw Errors.conflict(`A recipient named "${name}" already exists`);
  }
  throw err;
}

const asJson = (r: Parameters<typeof publicRecipient>[0]) => publicRecipient(r) as unknown as Prisma.InputJsonValue;

/**
 * How many times each PIN was unlocked in the last 30 days: each unlock gives
 * more guesses, so repeated ones are shown on Recipients (edge case E6).
 */
async function unlocksOf(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const groups = await prisma.auditLogEntry.groupBy({
    by: ['entityId'],
    where: { entityType: 'Recipient', action: 'PIN_UNLOCK', entityId: { in: ids }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.entityId, g._count._all]));
}

/** A PIN change: the recipient's row is held while it happens, as a PIN check holds it. */
async function changePin(
  id: string,
  actorId: string,
  action: 'PIN_SET' | 'PIN_RESET' | 'PIN_UNLOCK',
  decide: (r: NonNullable<Awaited<ReturnType<typeof prisma.recipient.findUnique>>>) => Promise<Prisma.RecipientUpdateInput>,
  reason?: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "recipients" WHERE "id" = ${id} FOR UPDATE`;
    const before = await tx.recipient.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Recipient');
    const after = await tx.recipient.update({ where: { id }, data: await decide(before) });
    await tx.auditLogEntry.create({
      data: {
        actorId,
        action,
        entityType: 'Recipient',
        entityId: id,
        before: asJson(before),
        after: { ...(publicRecipient(after) as unknown as Record<string, unknown>), ...(reason ? { reason } : {}) } as Prisma.InputJsonValue,
      },
    });
    return publicRecipient(after);
  });
}

export const RecipientService = {
  async list(filter: { q?: string; type?: RecipientType; active?: boolean } = {}) {
    const where: Prisma.RecipientWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.active !== undefined) where.active = filter.active;
    if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };
    const rows = await prisma.recipient.findMany({ where, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    const unlocks = await unlocksOf(rows.filter((r) => r.pinHash).map((r) => r.id));
    return rows.map((r) => ({ ...publicRecipient(r), pinUnlocks30d: unlocks.get(r.id) ?? 0 }));
  },

  async getById(id: string) {
    const recipient = await prisma.recipient.findUnique({ where: { id } });
    if (!recipient) throw Errors.notFound('Recipient');
    const unlocks = await unlocksOf(recipient.pinHash ? [recipient.id] : []);
    return { ...publicRecipient(recipient), pinUnlocks30d: unlocks.get(recipient.id) ?? 0 };
  },

  async create(input: CreateRecipientInput, actorId: string) {
    const name = cleanName(input.name);
    await assertNameFree(name);
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.recipient.create({
          data: { name, type: input.type, notes: input.notes?.trim() || null },
        });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'CREATE',
            entityType: 'Recipient',
            entityId: created.id,
            after: asJson(created),
          },
        });
        return publicRecipient(created);
      });
    } catch (err) {
      rethrowNameClash(err, name);
    }
  },

  async update(input: UpdateRecipientInput, actorId: string) {
    const before = await prisma.recipient.findUnique({ where: { id: input.id } });
    if (!before) throw Errors.notFound('Recipient');
    const data: Prisma.RecipientUpdateInput = {};
    if (input.name !== undefined) {
      data.name = cleanName(input.name);
      await assertNameFree(data.name, input.id);
    }
    if (input.type !== undefined) {
      data.type = input.type;
      // A machine or site has no PIN: whoever collects for it confirms.
      if (!holdsPin(input.type)) Object.assign(data, NO_PIN);
    }
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.active !== undefined) data.active = input.active;
    try {
      return await prisma.$transaction(async (tx) => {
        const after = await tx.recipient.update({ where: { id: input.id }, data });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'UPDATE',
            entityType: 'Recipient',
            entityId: input.id,
            before: asJson(before),
            after: asJson(after),
          },
        });
        return publicRecipient(after);
      });
    } catch (err) {
      rethrowNameClash(err, String(data.name ?? before.name));
    }
  },

  /**
   * A first PIN, typed by the person themselves at the counter. A PIN already
   * set is reset first, with a reason, so a store controller can't quietly
   * replace someone's PIN with one they know.
   */
  async setPin(id: string, pin: string, actorId: string) {
    if (!PIN_PATTERN.test(pin)) throw Errors.validation('A PIN is 4 to 6 digits.');
    if (isWeakPin(pin)) throw Errors.weakPin();
    const pinHash = await hashPin(pin);
    return changePin(id, actorId, 'PIN_SET', async (r) => {
      if (!holdsPin(r.type)) throw Errors.validation(`${r.name} is a ${r.type.toLowerCase()}: whoever collects for it confirms with their own PIN.`);
      if (!r.active) throw Errors.validation('Recipient is inactive');
      if (r.pinHash) throw Errors.conflict(`${r.name} already has a PIN. Reset it first.`);
      return { pinHash, pinSetAt: new Date(), pinFailedTries: 0, pinLockedAt: null };
    });
  },

  /** Clears the PIN, with a reason: forgotten, or someone else may know it. */
  async resetPin(id: string, reason: string, actorId: string) {
    return changePin(id, actorId, 'PIN_RESET', async (r) => {
      if (!r.pinHash) throw Errors.invalidState(`${r.name} has no PIN to reset.`);
      return { ...NO_PIN };
    }, reason);
  },

  /** The same PIN works again after too many wrong tries. */
  async unlockPin(id: string, actorId: string) {
    return changePin(id, actorId, 'PIN_UNLOCK', async (r) => {
      if (!r.pinLockedAt) throw Errors.invalidState(`${r.name}'s PIN is not locked.`);
      return { pinFailedTries: 0, pinLockedAt: null };
    });
  },
};
