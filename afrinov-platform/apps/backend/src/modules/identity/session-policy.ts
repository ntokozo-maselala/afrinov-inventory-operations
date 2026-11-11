// When a sign-in ends (ADR-035). A token lasts the idle time set in
// security.sessionTimeoutMinutes and is renewed while the person is active, so
// a screen left alone signs itself out; a sign-in still ends 12 hours after it
// began, however active. Times are JWT seconds since the epoch.

/** The longest a sign-in lasts, renewals included: a working day and a half. */
export const SESSION_LIMIT_SECONDS = 12 * 60 * 60;

/** As the setting's catalogue entry: 60 minutes, between 5 and 720. */
export const IDLE_DEFAULT_MINUTES = 60;
export const IDLE_MIN_MINUTES = 5;
export const IDLE_MAX_MINUTES = 720;

/** A token's issue time may run this far ahead of this server's clock. */
const CLOCK_TOLERANCE_SECONDS = 30;

const isEpochSeconds = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * The idle time, in seconds, from the setting's value. The value is checked
 * when it is saved; anything else read back falls back to the default, so a
 * bad row can neither keep a session open for ever nor close every one at once.
 */
export function idleSecondsFrom(minutes: unknown): number {
  const ok = typeof minutes === 'number' && Number.isInteger(minutes)
    && minutes >= IDLE_MIN_MINUTES && minutes <= IDLE_MAX_MINUTES;
  return (ok ? minutes : IDLE_DEFAULT_MINUTES) * 60;
}

/**
 * When the sign-in a token belongs to began. A token issued before ADR-035
 * has no auth_time, so its sign-in began when it was issued; an auth_time
 * after the issue time can't be, and is ignored. Null when neither reads.
 */
export function authTimeOf(claims: { iat?: unknown; auth_time?: unknown }): number | null {
  if (!isEpochSeconds(claims.iat)) return null;
  if (isEpochSeconds(claims.auth_time) && claims.auth_time <= claims.iat) return claims.auth_time;
  return claims.iat;
}

/**
 * When a token issued now expires: the idle time from now, but never past 12
 * hours from sign-in. Null once those 12 hours are up (or for a sign-in dated
 * ahead of now): the person signs in again.
 */
export function sessionExpiry({ now, authTime, idleSeconds }: { now: number; authTime: number; idleSeconds: number }): number | null {
  const limit = authTime + SESSION_LIMIT_SECONDS;
  if (authTime > now || now >= limit) return null;
  return Math.min(now + idleSeconds, limit);
}

/**
 * Whether a token has gone unrenewed for longer than the current idle time.
 * Its own expiry holds the idle time it was issued with; this holds the
 * current one, so a shorter setting closes idle sessions at once. An issue
 * time that can't be read, or lies well ahead, fails closed.
 */
export function isIdleTooLong({ now, issuedAt, idleSeconds }: { now: number; issuedAt: unknown; idleSeconds: number }): boolean {
  if (!isEpochSeconds(issuedAt)) return true;
  if (issuedAt > now + CLOCK_TOLERANCE_SECONDS) return true;
  return now - issuedAt > idleSeconds;
}

/**
 * Whether a sign-in began before the account's password last changed
 * (ADR-036): such a sign-in is over, so a new password ends every other
 * session. Whole seconds, as JWT times are, so the token issued with the
 * change itself (same second) still counts. A sign-in time that can't be read
 * counts as before.
 */
export function signInPredatesPassword(authTime: number | null, passwordChangedAt: Date | null | undefined): boolean {
  if (!passwordChangedAt) return false;
  if (authTime === null) return true;
  return authTime < Math.floor(passwordChangedAt.getTime() / 1000);
}
