// Proof of receipt (ADR-034): the person collecting an issue or a tool loan
// confirms the slip with their counter PIN, a signature, or a photo of the
// signed paper slip, or the reason they didn't is recorded.
//
// The slip posts first, exactly as it always has: stock has left the shelf
// whether or not anyone signs. A confirmation is a record beside the slip
// (one issueId) and never moves a balance. It carries a fingerprint of the
// slip's lines, so a line reversed after it was confirmed shows.
import { createHash } from 'node:crypto';
import { Prisma, InventoryTransactionType, type ReceiptMethod, type ReceiptSkipReason, type ReceiptSlipKind, type RecipientType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal } from '../../shared/decimal.js';
import { holdsPin } from '../operations/recipient-pin.js';

type Db = Prisma.TransactionClient | typeof prisma;

export const SKIP_REASONS: ReceiptSkipReason[] = ['LEFT', 'CANNOT', 'NO_SCREEN', 'DISPUTED', 'OTHER'];
/** These need a note: what happened, or what they say is wrong. */
export const NOTE_REASONS: ReceiptSkipReason[] = ['DISPUTED', 'OTHER'];

/** The largest signature drawn on screen, and the largest photo of a signed slip. */
export const SIGNATURE_MAX_BYTES = 200 * 1024;
export const PAPER_MAX_BYTES = 5 * 1024 * 1024;

export type ReceiptImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/** One slip as a confirmation sees it. */
export interface Slip {
  id: string;
  kind: ReceiptSlipKind;
  recipientId: string | null;
  recipientName: string | null;
  recipientType: RecipientType | null;
  /** Lines not reversed, which a confirmation covers. */
  lines: Array<{ id: string; quantity: string }>;
}

/** What a slip shows about its receipt. Null on the slip when nothing has been recorded. */
export interface ReceiptSummary {
  method: ReceiptMethod;
  signerId: string | null;
  signerName: string | null;
  /** The person collected for the slip's machine or site. */
  collectedFor: boolean;
  reason: ReceiptSkipReason | null;
  note: string | null;
  confirmedAt: string;
  capturedByName: string;
  hasImage: boolean;
  imageRemoved: boolean;
  /** Confirmed, then a line was reversed: the slip no longer matches what was confirmed. */
  changed: boolean;
}

export type ConfirmInput =
  | { slipId: string; method: 'PIN'; signerId: string; actorId: string }
  | { slipId: string; method: 'SIGNATURE' | 'PAPER'; signerId: string; image: { contentType: ReceiptImageType; data: Buffer }; actorId: string }
  | { slipId: string; method: 'NONE'; reason: ReceiptSkipReason; note?: string; actorId: string };

/**
 * A fingerprint of a slip's lines: the ones not reversed, by id and quantity.
 * Ledger rows never change, so it moves only when a line is reversed.
 */
export function slipFingerprint(lines: Array<{ id: string; quantity: string | Prisma.Decimal }>): string {
  const text = lines.map((l) => `${l.id}:${toDecimal(l.quantity).toString()}`).sort().join('|');
  return createHash('sha256').update(text).digest('hex');
}

/** The slip an issueId names: an issue's or a tool loan's lines. */
export async function loadSlip(slipId: string, db: Db = prisma): Promise<Slip> {
  const rows = await db.inventoryTransaction.findMany({
    where: { issueId: slipId, reversesId: null, type: { in: [InventoryTransactionType.ISSUE, InventoryTransactionType.LOAN] } },
    select: { id: true, type: true, quantity: true, recipientId: true, recipient: { select: { name: true, type: true } }, reversedBy: { select: { id: true } } },
  });
  const first = rows[0];
  if (!first) throw Errors.notFound('Slip');
  return {
    id: slipId,
    kind: first.type === InventoryTransactionType.LOAN ? 'LOAN' : 'ISSUE',
    recipientId: first.recipientId,
    recipientName: first.recipient?.name ?? null,
    recipientType: first.recipient?.type ?? null,
    lines: rows.filter((r) => !r.reversedBy).map((r) => ({ id: r.id, quantity: r.quantity.toString() })),
  };
}

/**
 * Who may confirm a slip. A worker or contractor confirms their own slip and
 * nobody else's: no one confirms on their behalf (owner's answer, 10 Nov
 * 2026). A machine or site can't, so a person collecting for it does, chosen
 * from the workers and contractors.
 */
export async function checkSigner(slip: Slip, signerId: string, db: Db = prisma): Promise<{ name: string }> {
  if (slip.recipientId && slip.recipientType && holdsPin(slip.recipientType) && signerId !== slip.recipientId) {
    throw Errors.signerNotRecipient(slip.recipientName ?? 'the recipient');
  }
  const signer = await db.recipient.findUnique({ where: { id: signerId }, select: { name: true, type: true, active: true } });
  if (!signer) throw Errors.notFound('Recipient');
  if (!holdsPin(signer.type)) throw Errors.validation(`${signer.name} is a ${signer.type.toLowerCase()}: choose the person who collected.`);
  if (!signer.active) throw Errors.validation(`${signer.name} is inactive`);
  return { name: signer.name };
}

/** Checks an image is what it says: a PNG signature, or a JPEG, PNG or WebP photo, within its size. */
export function checkImage(method: 'SIGNATURE' | 'PAPER', contentType: ReceiptImageType, data: Buffer): void {
  if (data.length === 0) throw Errors.validation('The image is empty.');
  if (method === 'SIGNATURE' && contentType !== 'image/png') throw Errors.validation('A signature is sent as a PNG image.');
  const max = method === 'SIGNATURE' ? SIGNATURE_MAX_BYTES : PAPER_MAX_BYTES;
  if (data.length > max) {
    throw Errors.validation(method === 'SIGNATURE' ? 'The signature image is too large.' : 'That photo is over 5 MB. Choose a smaller one.');
  }
  const is = {
    'image/png': data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/jpeg': data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    'image/webp': data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP',
  }[contentType];
  if (!is) throw Errors.validation('The image is not a valid picture of the type it says.');
}

type ConfirmationRow = Prisma.ReceiptConfirmationGetPayload<{
  include: { signer: { select: { name: true } }; capturedBy: { select: { name: true } }; image: { select: { size: true } } };
}>;

const SUMMARY_INCLUDE = { signer: { select: { name: true } }, capturedBy: { select: { name: true } }, image: { select: { size: true } } } as const;

function summarise(row: ConfirmationRow, slip: Pick<Slip, 'recipientId'> & { fingerprint: string }): ReceiptSummary {
  return {
    method: row.method,
    signerId: row.signerId,
    signerName: row.signer?.name ?? null,
    collectedFor: row.signerId !== null && row.signerId !== slip.recipientId,
    reason: row.reason,
    note: row.note,
    confirmedAt: row.confirmedAt.toISOString(),
    capturedByName: row.capturedBy.name,
    hasImage: row.image !== null,
    imageRemoved: row.imageRemovedAt !== null,
    changed: row.method !== 'NONE' && row.linesFingerprint !== slip.fingerprint,
  };
}

/** A slip's receipt: its confirmation, or else the latest note that it wasn't confirmed. */
const current = (rows: ConfirmationRow[]) =>
  rows.find((r) => r.method !== 'NONE') ?? [...rows].sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime())[0] ?? null;

export const ReceiptConfirmationService = {
  /**
   * Records how the slip was confirmed, or why it wasn't. Runs in the
   * idempotent transaction when there is one, so a retry replays. A PIN is
   * checked before this is called (verifyPin), as its wrong tries must be
   * counted even though this then refuses.
   */
  async confirm(input: ConfirmInput, within?: Prisma.TransactionClient): Promise<ReceiptSummary> {
    if (input.method === 'NONE' && NOTE_REASONS.includes(input.reason) && !input.note?.trim()) {
      throw Errors.validation(input.reason === 'DISPUTED' ? 'Say what they say is wrong with the slip.' : 'Say what happened.');
    }
    if (input.method === 'SIGNATURE' || input.method === 'PAPER') checkImage(input.method, input.image.contentType, input.image.data);

    return inTx(within, async (tx) => {
      // One confirmation of a slip at a time, so two at once can't both pass the check below.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`afrinov:receipt:${input.slipId}`}))`;
      const slip = await loadSlip(input.slipId, tx);
      if (input.method !== 'NONE') await checkSigner(slip, input.signerId, tx);
      const confirmed = await tx.receiptConfirmation.findFirst({ where: { slipId: slip.id, method: { not: 'NONE' } }, select: { id: true } });
      if (confirmed) throw Errors.alreadyConfirmed();

      const fingerprint = slipFingerprint(slip.lines);
      try {
        const row = await tx.receiptConfirmation.create({
          data: input.method === 'NONE'
            ? { slipId: slip.id, slipKind: slip.kind, method: 'NONE', reason: input.reason, note: input.note?.trim() || null, capturedById: input.actorId }
            : {
              slipId: slip.id,
              slipKind: slip.kind,
              method: input.method,
              signerId: input.signerId,
              linesFingerprint: fingerprint,
              capturedById: input.actorId,
              ...(input.method === 'PIN' ? {} : { image: { create: { contentType: input.image.contentType, size: input.image.data.length, data: new Uint8Array(input.image.data) } } }),
            },
          include: SUMMARY_INCLUDE,
        });
        return summarise(row, { recipientId: slip.recipientId, fingerprint });
      } catch (err) {
        // The partial unique index: confirmed by someone else at the same moment.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.alreadyConfirmed();
        throw err;
      }
    });
  },

  /**
   * The receipt of each slip, for the slip lists. `lines` are each slip's
   * lines as the list has them, so `changed` is worked out from what is shown.
   */
  async forSlips(slips: Array<{ id: string; recipientId: string | null; lines: Array<{ id: string; quantity: string; reversed: boolean }> }>, db: Db = prisma): Promise<Map<string, ReceiptSummary>> {
    const out = new Map<string, ReceiptSummary>();
    if (slips.length === 0) return out;
    const rows = await db.receiptConfirmation.findMany({ where: { slipId: { in: slips.map((s) => s.id) } }, include: SUMMARY_INCLUDE });
    for (const s of slips) {
      const row = current(rows.filter((r) => r.slipId === s.id));
      if (row) out.set(s.id, summarise(row, { recipientId: s.recipientId, fingerprint: slipFingerprint(s.lines.filter((l) => !l.reversed)) }));
    }
    return out;
  },

  /** Of these slips, the ones confirmed (by PIN, signature or paper). */
  async confirmedOf(slipIds: string[], db: Db = prisma): Promise<Set<string>> {
    if (slipIds.length === 0) return new Set();
    const rows = await db.receiptConfirmation.findMany({ where: { slipId: { in: slipIds }, method: { not: 'NONE' } }, select: { slipId: true } });
    return new Set(rows.map((r) => r.slipId));
  },

  /** The signature or photo a slip was confirmed with. */
  async image(slipId: string): Promise<{ contentType: string; data: Buffer }> {
    const row = await prisma.receiptConfirmation.findFirst({
      where: { slipId, method: { in: ['SIGNATURE', 'PAPER'] } },
      select: { image: { select: { contentType: true, data: true } } },
    });
    if (!row?.image) throw Errors.notFound('Signature');
    return { contentType: row.image.contentType, data: Buffer.from(row.image.data) };
  },
};
