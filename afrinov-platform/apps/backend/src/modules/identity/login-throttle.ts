// Failed sign-ins per account (system audit F4). The limit in server.ts counts
// by address, which can't tell people apart behind one proxy or one office
// connection; this counts by account, so guessing one person's password is
// slowed without locking out everyone else at the counter.
//
// Kept in memory: one backend process serves the store. A restart forgets the
// count, which only gives a guesser a fresh window, never a lockout.

/** Failed sign-ins an account may have in the window before it waits. */
export const ACCOUNT_FAILURE_LIMIT = 10;
export const ACCOUNT_FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** Accounts tracked at once; the oldest is dropped past this, so a flood can't grow memory. */
const MAX_TRACKED = 10_000;

export interface LoginThrottle {
  /** Whether this account has used up its failed sign-ins for now. */
  isBlocked(email: string): boolean;
  recordFailure(email: string): void;
  /** After a successful sign-in, or an Admin's new temporary password. */
  clear(email: string): void;
}

export function createLoginThrottle(now: () => number = Date.now): LoginThrottle {
  const failures = new Map<string, number[]>();
  const key = (email: string) => email.trim().toLowerCase();
  const recent = (k: string) => {
    const since = now() - ACCOUNT_FAILURE_WINDOW_MS;
    const kept = (failures.get(k) ?? []).filter((t) => t > since);
    if (kept.length) failures.set(k, kept);
    else failures.delete(k);
    return kept;
  };
  return {
    isBlocked: (email) => recent(key(email)).length >= ACCOUNT_FAILURE_LIMIT,
    recordFailure(email) {
      const k = key(email);
      const kept = recent(k);
      failures.delete(k);
      failures.set(k, [...kept, now()]);
      if (failures.size > MAX_TRACKED) failures.delete(failures.keys().next().value!);
    },
    clear: (email) => { failures.delete(key(email)); },
  };
}

export const loginThrottle = createLoginThrottle();

export const ACCOUNT_THROTTLED_MESSAGE = 'Too many wrong passwords for this account. Wait 15 minutes, or ask an Admin to set a temporary password.';
