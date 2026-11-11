import { describe, it, expect, beforeEach } from 'vitest';
import {
  RENEW_AFTER_MS, SESSION_LIMIT_MS, WARN_BEFORE_MS,
  forgetOwnActivity, readLastActivity, readSessionTimes, recordActivity, sessionPhase, type SessionTimes,
} from './session';

/** A token with these claims; the signature is never checked in the browser. */
function token(claims: Record<string, unknown>): string {
  const part = (o: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.signature`;
}

describe('readSessionTimes', () => {
  it('reads when the token was issued, when it expires and when the sign-in began, in ms', () => {
    expect(readSessionTimes(token({ sub: 'u1', iat: 1000, exp: 4600, auth_time: 400 })))
      .toEqual({ issuedAt: 1_000_000, expiresAt: 4_600_000, signedInAt: 400_000 });
  });

  it('takes the issue time as the sign-in for a token issued before sign-ins were recorded', () => {
    expect(readSessionTimes(token({ iat: 1000, exp: 4600 }))?.signedInAt).toBe(1_000_000);
  });

  it('reads a token whose name is not plain ASCII', () => {
    expect(readSessionTimes(token({ name: 'Nomsa Ndlovú', iat: 1000, exp: 4600 }))?.expiresAt).toBe(4_600_000);
  });

  it.each([
    ['no token', null],
    ['an empty token', ''],
    ['the mock token', 'mock-token'],
    ['a payload that is not JSON', 'a.bm90IGpzb24.c'],
    ['no expiry', token({ iat: 1000 })],
    ['no issue time', token({ exp: 4600 })],
    ['an expiry before the issue time', token({ iat: 4600, exp: 1000 })],
    ['text times', token({ iat: '1000', exp: '4600' })],
  ])('is null for %s', (_label, value) => {
    expect(readSessionTimes(value as string | null)).toBeNull();
  });
});

describe('sessionPhase', () => {
  const signedInAt = 1_000_000_000;
  const times = (issuedAt: number, lifetime = 60 * 60_000): SessionTimes => ({ issuedAt, expiresAt: issuedAt + lifetime, signedInAt });

  it('is active while nothing needs doing', () => {
    const t = times(signedInAt);
    expect(sessionPhase({ now: signedInAt + 10 * 60_000, times: t, lastActivity: 0 })).toBe('active');
  });

  it('renews once the person has done something since the token was issued, at most once a minute', () => {
    const t = times(signedInAt);
    expect(sessionPhase({ now: signedInAt + RENEW_AFTER_MS - 1, times: t, lastActivity: signedInAt + 1000 })).toBe('active');
    expect(sessionPhase({ now: signedInAt + RENEW_AFTER_MS, times: t, lastActivity: signedInAt + 1000 })).toBe('renew');
    // Activity before the token was issued (the click that signed in) doesn't count.
    expect(sessionPhase({ now: signedInAt + 30 * 60_000, times: t, lastActivity: signedInAt - 1 })).toBe('active');
  });

  it('warns in the last minute when nothing has happened', () => {
    const t = times(signedInAt);
    expect(sessionPhase({ now: t.expiresAt - WARN_BEFORE_MS - 1, times: t, lastActivity: 0 })).toBe('active');
    expect(sessionPhase({ now: t.expiresAt - WARN_BEFORE_MS, times: t, lastActivity: 0 })).toBe('warn');
  });

  it('renews rather than warns once the person is back', () => {
    const t = times(signedInAt);
    expect(sessionPhase({ now: t.expiresAt - 10_000, times: t, lastActivity: t.expiresAt - 20_000 })).toBe('renew');
  });

  it('has ended at the expiry', () => {
    const t = times(signedInAt);
    expect(sessionPhase({ now: t.expiresAt, times: t, lastActivity: t.expiresAt - 1 })).toBe('ended');
  });

  // The 12 hours are up: renewing would be refused, so the warning stands.
  it('warns, never renews, when the token runs to the end of the sign-in', () => {
    const issuedAt = signedInAt + SESSION_LIMIT_MS - 30 * 60_000;
    const t: SessionTimes = { issuedAt, expiresAt: signedInAt + SESSION_LIMIT_MS, signedInAt };
    expect(sessionPhase({ now: issuedAt + 10 * 60_000, times: t, lastActivity: issuedAt + 5 * 60_000 })).toBe('active');
    expect(sessionPhase({ now: t.expiresAt - 30_000, times: t, lastActivity: t.expiresAt - 31_000 })).toBe('warn');
  });
});

describe('activity across tabs', () => {
  beforeEach(() => { localStorage.clear(); forgetOwnActivity(); });

  it('still counts this tab\'s own activity when storage cannot be used', () => {
    const real = localStorage.setItem;
    const realGet = localStorage.getItem;
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    localStorage.getItem = () => { throw new Error('SecurityError'); };
    try {
      recordActivity(5000);
      expect(readLastActivity()).toBe(5000);
    } finally {
      localStorage.setItem = real;
      localStorage.getItem = realGet;
    }
  });

  it('is shared through storage, so working in one tab keeps the others signed in', () => {
    expect(readLastActivity()).toBe(0);
    recordActivity(123_456);
    expect(readLastActivity()).toBe(123_456);
  });

  it('never moves backwards', () => {
    recordActivity(200);
    recordActivity(100);
    expect(readLastActivity()).toBe(200);
  });

  it('reads anything unreadable as no activity', () => {
    localStorage.setItem('afrinov.lastActivity', 'yesterday');
    expect(readLastActivity()).toBe(0);
  });
});
