// The sign-in log (system audit F3, ADR-039): each sign-in, each failed or
// throttled attempt, and each sign-out, with the address and browser it came
// from, kept 12 months and shown to Admins on Settings → Users → Sign-ins.
//
// A sign-in left alone ends when its token runs out, which writes nothing: its
// end is its last renewal plus the idle time. A password is never recorded.
import { prisma } from '../../shared/db.js';

export const SIGN_IN_OUTCOMES = ['SIGN_IN', 'FAILED', 'THROTTLED', 'SIGN_OUT'] as const;
export type SignInOutcome = (typeof SIGN_IN_OUTCOMES)[number];

/** How long the log is kept. */
export const SIGN_IN_KEEP_MONTHS = 12;

/** Where an attempt came from, as the request says. */
export interface SignInContext {
  ip?: string | null;
  userAgent?: string | null;
}

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

/**
 * Writes one row. Best-effort: a sign-in isn't refused because its row
 * couldn't be written, but the failure is logged by the caller's `onError`.
 */
export async function recordSignIn(
  entry: { userId: string | null; email: string; outcome: SignInOutcome } & SignInContext,
  onError: (err: Error) => void = () => {},
): Promise<void> {
  try {
    await prisma.signInEvent.create({
      data: {
        userId: entry.userId,
        email: clip(entry.email.trim().toLowerCase(), 320)!,
        outcome: entry.outcome,
        ip: clip(entry.ip, 64),
        userAgent: clip(entry.userAgent, 300),
      },
    });
  } catch (err) {
    onError(err as Error);
  }
}

export interface SignInFilter {
  userId?: string;
  outcome?: SignInOutcome;
  email?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

/** Newest first, with the account's name where there is one. */
export async function listSignIns(filter: SignInFilter = {}) {
  const where = {
    ...(filter.userId ? { userId: filter.userId } : {}),
    ...(filter.outcome ? { outcome: filter.outcome } : {}),
    ...(filter.email ? { email: { contains: filter.email.trim().toLowerCase() } } : {}),
    ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
  };
  const take = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const [rows, total] = await Promise.all([
    prisma.signInEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip: filter.offset ?? 0,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.signInEvent.count({ where }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, at: r.createdAt.toISOString(), outcome: r.outcome as SignInOutcome, email: r.email,
      user: r.user ? { id: r.user.id, name: r.user.name } : null, ip: r.ip, userAgent: r.userAgent,
    })),
  };
}

/** Removes rows older than 12 months, on the server's hourly sweep. */
export async function pruneSignIns(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - SIGN_IN_KEEP_MONTHS);
  const { count } = await prisma.signInEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
