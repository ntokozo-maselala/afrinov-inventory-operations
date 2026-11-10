// Proof of receipt across a database (ADR-034): slips still waiting for the
// person collecting to confirm them, images past their keep period, and the
// rules a confirmation must keep. Shared by the Dashboard count, the hourly
// image removal in server.ts and `npm run check:receipts`.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { SettingsService } from '../settings/settings.service.js';
import { slipFingerprint } from './receipt-confirmation.service.js';

/** How far back the Dashboard counts slips not confirmed, so the number can't grow for ever. */
export const PENDING_DAYS = 30;

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** The months before `now`, as the calendar counts them. */
export function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export interface PendingReceipts {
  since: string;
  days: number;
  /** Issue slips and tool check-outs with a line still standing and no confirmation. */
  issues: number;
  loans: number;
  /** Of those, how many the person collecting said were wrong. */
  disputed: number;
  oldestAt: string | null;
}

interface PendingRow { kind: 'ISSUE' | 'LOAN'; slips: number; disputed: number; oldest: Date | null }

/**
 * Slips posted in the last `days` days with no confirmation. A slip whose
 * every line was reversed has nothing left to confirm, so it isn't counted.
 */
export async function pendingReceipts(now = new Date(), days = PENDING_DAYS): Promise<PendingReceipts> {
  const since = daysBefore(now, days);
  const rows = await prisma.$queryRaw<PendingRow[]>`
    WITH slips AS (
      SELECT t."issue_id" AS slip_id, MIN(t."type"::text) AS kind, MIN(t."posted_at") AS posted_at
      FROM "inventory_transactions" t
      WHERE t."type" IN ('ISSUE', 'LOAN') AND t."issue_id" IS NOT NULL AND t."reverses_id" IS NULL
        AND t."posted_at" >= ${since}
        AND NOT EXISTS (SELECT 1 FROM "inventory_transactions" r WHERE r."reverses_id" = t."id")
      GROUP BY t."issue_id"
    )
    SELECT s.kind, COUNT(*)::int AS slips,
      COUNT(*) FILTER (WHERE (
        SELECT c."reason" FROM "receipt_confirmations" c WHERE c."slip_id" = s.slip_id ORDER BY c."confirmed_at" DESC LIMIT 1
      ) = 'DISPUTED')::int AS disputed,
      MIN(s.posted_at) AS oldest
    FROM slips s
    WHERE NOT EXISTS (SELECT 1 FROM "receipt_confirmations" c WHERE c."slip_id" = s.slip_id AND c."method" <> 'NONE')
    GROUP BY s.kind`;
  const of = (kind: PendingRow['kind']) => rows.find((r) => r.kind === kind);
  const oldest = rows.map((r) => r.oldest).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    since: since.toISOString(),
    days,
    issues: of('ISSUE')?.slips ?? 0,
    loans: of('LOAN')?.slips ?? 0,
    disputed: rows.reduce((n, r) => n + r.disputed, 0),
    oldestAt: oldest?.toISOString() ?? null,
  };
}

/**
 * Removes signatures and photos older than inventory.receiptImageKeepMonths
 * (0: keep them always). The record stays, marked with when its image went,
 * so the slip still says it was signed. A batch at a time; returns how many.
 */
export async function pruneReceiptImages(now = new Date(), batch = 500): Promise<number> {
  const months = await SettingsService.getValue<number>('inventory.receiptImageKeepMonths');
  if (!months || months <= 0) return 0;
  const cutoff = monthsBefore(now, months);
  return prisma.$transaction(async (tx) => {
    const due = await tx.receiptConfirmation.findMany({
      where: { confirmedAt: { lt: cutoff }, image: { isNot: null } },
      select: { id: true },
      orderBy: { confirmedAt: 'asc' },
      take: batch,
    });
    if (due.length === 0) return 0;
    const ids = due.map((d) => d.id);
    await tx.receiptImage.deleteMany({ where: { confirmationId: { in: ids } } });
    await tx.receiptConfirmation.updateMany({ where: { id: { in: ids } }, data: { imageRemovedAt: now } });
    return ids.length;
  });
}

type Client = Pick<Prisma.TransactionClient, 'inventoryTransaction' | 'receiptConfirmation' | 'setting'>;

export interface ReceiptReport {
  slips: number;
  confirmed: Record<'PIN' | 'SIGNATURE' | 'PAPER', number>;
  /** Slips with a line still standing and no confirmation, by how old they are. */
  waiting: { today: number; week: number; month: number; older: number };
  /** Who posted the slips still waiting, most first. */
  waitingByIssuer: Array<{ name: string; slips: number }>;
  disputed: string[];
  /** Confirmed, then a line was reversed. */
  changedAfter: string[];
  imagesDue: number;
  /** Rules broken: a confirmation for a slip that doesn't exist, or by someone other than the slip's worker or contractor. */
  orphaned: string[];
  wrongSigner: string[];
}

/** The whole database's slips and their receipts, for check:receipts. Read-only. */
export async function checkReceipts(db: Client = prisma, now = new Date()): Promise<ReceiptReport> {
  const [lines, confirmations, keep] = await Promise.all([
    db.inventoryTransaction.findMany({
      where: { type: { in: ['ISSUE', 'LOAN'] }, issueId: { not: null }, reversesId: null },
      select: { id: true, issueId: true, quantity: true, postedAt: true, recipientId: true, recipient: { select: { type: true } }, actor: { select: { name: true } }, reversedBy: { select: { id: true } } },
    }),
    db.receiptConfirmation.findMany({
      select: { slipId: true, method: true, reason: true, signerId: true, linesFingerprint: true, confirmedAt: true, imageRemovedAt: true, image: { select: { size: true } } },
      orderBy: { confirmedAt: 'asc' },
    }),
    db.setting.findUnique({ where: { key: 'inventory.receiptImageKeepMonths' } }),
  ]);

  const slips = new Map<string, typeof lines>();
  for (const l of lines) slips.set(l.issueId!, [...(slips.get(l.issueId!) ?? []), l]);
  const bySlip = new Map<string, typeof confirmations>();
  for (const c of confirmations) bySlip.set(c.slipId, [...(bySlip.get(c.slipId) ?? []), c]);

  const report: ReceiptReport = {
    slips: slips.size,
    confirmed: { PIN: 0, SIGNATURE: 0, PAPER: 0 },
    waiting: { today: 0, week: 0, month: 0, older: 0 },
    waitingByIssuer: [],
    disputed: [],
    changedAfter: [],
    imagesDue: 0,
    orphaned: [],
    wrongSigner: [],
  };
  const issuers = new Map<string, number>();
  const age = (d: Date) => (now.getTime() - d.getTime()) / 86_400_000;

  for (const [slipId, own] of slips) {
    const standing = own.filter((l) => !l.reversedBy);
    const rows = bySlip.get(slipId) ?? [];
    const confirmation = rows.find((r) => r.method !== 'NONE');
    if (confirmation) {
      report.confirmed[confirmation.method as 'PIN' | 'SIGNATURE' | 'PAPER']++;
      if (confirmation.linesFingerprint !== slipFingerprint(standing)) report.changedAfter.push(slipId);
      const first = own[0]!;
      if (first.recipientId && (first.recipient?.type === 'WORKER' || first.recipient?.type === 'CONTRACTOR') && confirmation.signerId !== first.recipientId) {
        report.wrongSigner.push(slipId);
      }
      continue;
    }
    if (standing.length === 0) continue;
    if (rows.at(-1)?.reason === 'DISPUTED') report.disputed.push(slipId);
    const days = age(own[0]!.postedAt);
    if (days < 1) report.waiting.today++;
    else if (days < 7) report.waiting.week++;
    else if (days < 30) report.waiting.month++;
    else report.waiting.older++;
    const name = own[0]!.actor.name;
    issuers.set(name, (issuers.get(name) ?? 0) + 1);
  }
  report.waitingByIssuer = [...issuers].map(([name, n]) => ({ name, slips: n })).sort((a, b) => b.slips - a.slips || a.name.localeCompare(b.name));
  report.orphaned = [...bySlip.keys()].filter((id) => !slips.has(id)).sort();

  const months = Number(keep?.value ?? 24);
  if (months > 0) {
    const cutoff = monthsBefore(now, months);
    report.imagesDue = confirmations.filter((c) => c.image && c.confirmedAt < cutoff).length;
  }
  report.disputed.sort();
  report.changedAfter.sort();
  report.wrongSigner.sort();
  return report;
}
