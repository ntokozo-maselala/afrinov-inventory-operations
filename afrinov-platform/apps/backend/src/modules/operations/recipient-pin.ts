// Counter PINs (ADR-034): how a worker or contractor confirms what they take
// at the store counter. Only a bcrypt hash is stored. Wrong tries are counted
// in a transaction of their own, so they stand even though the confirmation
// they were for is refused.
import bcrypt from 'bcryptjs';
import type { Recipient, RecipientType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { SettingsService } from '../settings/settings.service.js';

/** 4 to 6 digits. */
export const PIN_PATTERN = /^\d{4,6}$/;

// A PIN is checked at the counter while someone waits, so a lighter cost than
// sign-in passwords (12). It still costs a guesser ~60 ms a try, and a PIN
// locks after inventory.receiptPinTries wrong ones.
const PIN_COST = 10;

/** Machines and sites can't confirm: whoever collects for them does. */
export const holdsPin = (type: RecipientType) => type === 'WORKER' || type === 'CONTRACTOR';

/**
 * Too easy to guess: one digit repeated (0000), a straight run up or down
 * (1234, 9876, 0123), or a pair repeated (1212).
 */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  if ('01234567890'.includes(pin) || '09876543210'.includes(pin)) return true;
  return pin.length % 2 === 0 && pin === pin.slice(0, 2).repeat(pin.length / 2);
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_COST);
}

/** What a recipient shows the client about its PIN: never the hash. */
export type PublicRecipient = Omit<Recipient, 'pinHash'> & { pinSet: boolean; pinLocked: boolean };

export function publicRecipient(r: Recipient): PublicRecipient {
  const { pinHash, ...rest } = r;
  return { ...rest, pinSet: pinHash !== null, pinLocked: r.pinLockedAt !== null };
}

type Verdict = { ok: true } | { ok: false; error: 'NOT_FOUND' | 'NOT_SET' | 'LOCKED' | 'MISMATCH'; name: string; triesLeft: number };

/**
 * Check a recipient's PIN, counting a wrong one. The recipient's row is held
 * FOR UPDATE, so tries made at the same moment are counted one after another
 * and none slips past the limit. The count commits before the refusal is
 * thrown, which is why this is not part of the confirmation's transaction.
 */
export async function verifyPin(recipientId: string, pin: string): Promise<void> {
  const limit = await SettingsService.getValue<number>('inventory.receiptPinTries');
  const verdict = await prisma.$transaction(async (tx): Promise<Verdict> => {
    await tx.$queryRaw`SELECT 1 FROM "recipients" WHERE "id" = ${recipientId} FOR UPDATE`;
    const r = await tx.recipient.findUnique({ where: { id: recipientId } });
    if (!r) return { ok: false, error: 'NOT_FOUND', name: '', triesLeft: 0 };
    if (!r.pinHash) return { ok: false, error: 'NOT_SET', name: r.name, triesLeft: 0 };
    if (r.pinLockedAt) return { ok: false, error: 'LOCKED', name: r.name, triesLeft: 0 };
    if (await bcrypt.compare(pin, r.pinHash)) {
      if (r.pinFailedTries > 0) await tx.recipient.update({ where: { id: r.id }, data: { pinFailedTries: 0 } });
      return { ok: true };
    }
    const tries = r.pinFailedTries + 1;
    const locks = tries >= limit;
    await tx.recipient.update({ where: { id: r.id }, data: { pinFailedTries: tries, ...(locks ? { pinLockedAt: new Date() } : {}) } });
    if (locks) {
      await tx.auditLogEntry.create({
        data: { actorId: null, action: 'PIN_LOCKED', entityType: 'Recipient', entityId: r.id, after: { name: r.name, pinFailedTries: tries } },
      });
    }
    return { ok: false, error: locks ? 'LOCKED' : 'MISMATCH', name: r.name, triesLeft: limit - tries };
  });
  if (verdict.ok) return;
  switch (verdict.error) {
    case 'NOT_FOUND': throw Errors.notFound('Recipient');
    case 'NOT_SET': throw Errors.pinNotSet(verdict.name);
    case 'LOCKED': throw Errors.pinLocked(verdict.name);
    case 'MISMATCH': throw Errors.pinMismatch(verdict.triesLeft);
  }
}
