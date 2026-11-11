// Issues sign-in tokens under the session rules (ADR-035, session-policy.ts):
// each lasts the idle time from security.sessionTimeoutMinutes, and carries
// auth_time, when the sign-in began, so renewals stop 12 hours after it.
import type { FastifyInstance } from 'fastify';
import { SettingsService } from '../settings/settings.service.js';
import { idleSecondsFrom, sessionExpiry } from './session-policy.js';
import type { SessionUser } from './identity.service.js';

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** The idle time in force now, in seconds. Never throws: a store it can't read gives the default. */
export async function currentIdleSeconds(): Promise<number> {
  return idleSecondsFrom(await SettingsService.getValue<unknown>('security.sessionTimeoutMinutes'));
}

/**
 * A token for this person, for a sign-in that began at `authTime` (now, for a
 * new sign-in). Null when that sign-in has run its 12 hours.
 */
export async function issueSessionToken(
  app: Pick<FastifyInstance, 'jwt'>,
  user: Pick<SessionUser, 'id' | 'email' | 'name' | 'roles'>,
  authTime?: number,
): Promise<string | null> {
  const now = nowSeconds();
  const exp = sessionExpiry({ now, authTime: authTime ?? now, idleSeconds: await currentIdleSeconds() });
  if (exp === null) return null;
  return app.jwt.sign(
    { sub: user.id, email: user.email, name: user.name, roles: user.roles, auth_time: authTime ?? now },
    // In words, as "<n>s": @fastify/jwt and fast-jwt read a bare number in different units. iat is now.
    { expiresIn: `${exp - now}s` },
  );
}
