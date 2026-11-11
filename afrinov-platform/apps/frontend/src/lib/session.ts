// Idle sign-out on the screen (ADR-035). The server issues a token for the
// idle time set in Settings → Security and refuses it once it runs out; this
// side renews it while the person is working, warns in the last minute when
// they are not, and ends the session when it has run out. A sign-in still ends
// 12 hours after it began. All times here are milliseconds.

/** The longest a sign-in lasts, as the server holds it (session-policy.ts). */
export const SESSION_LIMIT_MS = 12 * 60 * 60_000;
/** A token is renewed at most once a minute, however busy the person is. */
export const RENEW_AFTER_MS = 60_000;
/** How long before the end the warning shows. */
export const WARN_BEFORE_MS = 60_000;

const LAST_ACTIVITY_KEY = 'afrinov.lastActivity';

export interface SessionTimes {
  issuedAt: number;
  expiresAt: number;
  /** When the sign-in began: renewals stop 12 hours after it. */
  signedInAt: number;
}

export type SessionPhase = 'active' | 'renew' | 'warn' | 'ended';

const isEpochSeconds = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * The times a sign-in token carries, or null for anything that isn't one
 * (no token, the mock's, a damaged one): then nothing here acts, and the
 * server still decides. The signature is the server's to check, not ours.
 */
export function readSessionTimes(token: string | null): SessionTimes | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  let claims: { iat?: unknown; exp?: unknown; auth_time?: unknown };
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    claims = JSON.parse(new TextDecoder().decode(bytes)) as typeof claims;
  } catch {
    return null;
  }
  if (!claims || !isEpochSeconds(claims.iat) || !isEpochSeconds(claims.exp) || claims.exp <= claims.iat) return null;
  const signedIn = isEpochSeconds(claims.auth_time) && claims.auth_time <= claims.iat ? claims.auth_time : claims.iat;
  return { issuedAt: claims.iat * 1000, expiresAt: claims.exp * 1000, signedInAt: signedIn * 1000 };
}

/**
 * What the screen should do now. Renew when the person has done something
 * since the token was issued (and it is a minute old), as long as the sign-in
 * has time left; warn in the last minute otherwise; end at the expiry.
 */
export function sessionPhase({ now, times, lastActivity }: { now: number; times: SessionTimes; lastActivity: number }): SessionPhase {
  if (now >= times.expiresAt) return 'ended';
  if (canRenew(times) && lastActivity > times.issuedAt && now - times.issuedAt >= RENEW_AFTER_MS) return 'renew';
  if (times.expiresAt - now <= WARN_BEFORE_MS) return 'warn';
  return 'active';
}

/** Whether the token can be renewed at all, or runs to the end of the sign-in. */
export function canRenew(times: SessionTimes): boolean {
  return times.expiresAt < times.signedInAt + SESSION_LIMIT_MS;
}

// This tab's own last activity, for when storage can't be used.
let ownLastActivity = 0;

/**
 * When the person last did something, in any tab: kept in storage so working
 * in one tab keeps the others signed in. 0 when unknown.
 */
export function readLastActivity(): number {
  let stored = 0;
  try {
    const n = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (Number.isFinite(n) && n > 0) stored = n;
  } catch {
    // Unreadable storage: this tab's own activity still counts.
  }
  return Math.max(stored, ownLastActivity);
}

/** Records activity at `now`; never moves the time backwards. */
export function recordActivity(now: number): void {
  if (now > ownLastActivity) ownLastActivity = now;
  try {
    const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (!(stored >= now)) localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  } catch {
    // Private mode or storage full: this tab still counts its own activity.
  }
}

/** For tests: forgets this tab's own activity. */
export function forgetOwnActivity(): void {
  ownLastActivity = 0;
}
