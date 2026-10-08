// Recipients: the people and places stock is issued to — workers, machines,
// client sites and contractors. Most are not users who log in. A recipient is
// deactivated rather than deleted, so issue history keeps its name.
import { Prisma, type RecipientType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';

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

/** Trim and collapse whitespace in a recipient name, rejecting an empty result. */
function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw Errors.validation('Name is required');
  return trimmed;
}

/** Reject a case-insensitive name collision, optionally excluding the recipient being edited. */
async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.recipient.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw Errors.conflict(`A recipient named "${clash.name}" already exists`);
}

/** Translate a Prisma unique-constraint failure into a name conflict; rethrow other errors. */
function rethrowNameClash(err: unknown, name: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw Errors.conflict(`A recipient named "${name}" already exists`);
  }
  throw err;
}

export const RecipientService = {
  /** List recipients by optional name, type, and active filters, with active names first. */
  async list(filter: { q?: string; type?: RecipientType; active?: boolean } = {}) {
    const where: Prisma.RecipientWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.active !== undefined) where.active = filter.active;
    if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };
    return prisma.recipient.findMany({ where, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  },

  /** Return the recipient by ID, or throw a not-found error. */
  async getById(id: string) {
    const recipient = await prisma.recipient.findUnique({ where: { id } });
    if (!recipient) throw Errors.notFound('Recipient');
    return recipient;
  },

  /** Create a recipient with a normalized, unique name and its audit entry atomically. */
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
            after: created as unknown as Prisma.InputJsonValue,
          },
        });
        return created;
      });
    } catch (err) {
      rethrowNameClash(err, name);
    }
  },

  /**
   * Update supplied recipient fields and audit before/after values in one transaction.
   * Deactivation preserves the recipient record for existing issue history.
   */
  async update(input: UpdateRecipientInput, actorId: string) {
    const before = await prisma.recipient.findUnique({ where: { id: input.id } });
    if (!before) throw Errors.notFound('Recipient');
    const data: Prisma.RecipientUpdateInput = {};
    if (input.name !== undefined) {
      data.name = cleanName(input.name);
      await assertNameFree(data.name, input.id);
    }
    if (input.type !== undefined) data.type = input.type;
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
            before: before as unknown as Prisma.InputJsonValue,
            after: after as unknown as Prisma.InputJsonValue,
          },
        });
        return after;
      });
    } catch (err) {
      rethrowNameClash(err, String(data.name ?? before.name));
    }
  },
};
