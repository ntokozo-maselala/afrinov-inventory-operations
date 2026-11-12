// The session rules (ADR-035): a sign-in ends after the idle time set in
// security.sessionTimeoutMinutes, and in any case 12 hours after it began.
import { describe, it, expect } from 'vitest';
import {
  SESSION_LIMIT_SECONDS, authTimeOf, idleSecondsFrom, isIdleTooLong, sessionExpiry, signInPredatesPassword,
} from './session-policy.js';

describe('idleSecondsFrom', () => {
  it('reads the setting in minutes', () => {
    expect(idleSecondsFrom(60)).toBe(3600);
    expect(idleSecondsFrom(5)).toBe(300);
    expect(idleSecondsFrom(720)).toBe(43_200);
  });

  // The setting is checked when saved; a value read back that isn't one the
  // check allows (a hand-edited row, a mocked store) falls back to the default
  // rather than leaving a session open for ever or closing it at once.
  it.each([
    ['missing', undefined],
    ['null', null],
    ['text', '30'],
    ['not whole', 12.5],
    ['below 5', 4],
    ['above 720', 721],
    ['zero', 0],
    ['negative', -10],
    ['not finite', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['boolean', true],
  ])('falls back to 60 minutes when the value is %s', (_label, value) => {
    expect(idleSecondsFrom(value)).toBe(3600);
  });
});

describe('authTimeOf', () => {
  it('is the auth_time claim when the token carries one', () => {
    expect(authTimeOf({ iat: 2000, auth_time: 1000 })).toBe(1000);
  });

  // Tokens issued before ADR-035 carry no auth_time: their sign-in began when they were issued.
  it('is the issue time for a token without auth_time', () => {
    expect(authTimeOf({ iat: 2000 })).toBe(2000);
  });

  it('ignores an auth_time later than the issue time, which no sign-in can have', () => {
    expect(authTimeOf({ iat: 2000, auth_time: 3000 })).toBe(2000);
  });

  it.each([
    ['no times', {}],
    ['text times', { iat: '2000', auth_time: '1000' }],
    ['a fractional issue time', { iat: 2000.5 }],
    ['a negative issue time', { iat: -1 }],
  ])('is null for %s', (_label, claims) => {
    expect(authTimeOf(claims as { iat?: unknown; auth_time?: unknown })).toBeNull();
  });
});

describe('sessionExpiry', () => {
  const authTime = 1_000_000;

  it('is the idle time from now while the sign-in is young', () => {
    expect(sessionExpiry({ now: authTime, authTime, idleSeconds: 3600 })).toBe(authTime + 3600);
    expect(sessionExpiry({ now: authTime + 7200, authTime, idleSeconds: 3600 })).toBe(authTime + 10_800);
  });

  it('never runs past 12 hours from sign-in', () => {
    const now = authTime + SESSION_LIMIT_SECONDS - 600;
    expect(sessionExpiry({ now, authTime, idleSeconds: 3600 })).toBe(authTime + SESSION_LIMIT_SECONDS);
  });

  it('is null once the 12 hours are up: the person signs in again', () => {
    expect(sessionExpiry({ now: authTime + SESSION_LIMIT_SECONDS, authTime, idleSeconds: 3600 })).toBeNull();
    expect(sessionExpiry({ now: authTime + SESSION_LIMIT_SECONDS + 1, authTime, idleSeconds: 3600 })).toBeNull();
  });

  it('is null for a sign-in dated in the future', () => {
    expect(sessionExpiry({ now: authTime - 1, authTime, idleSeconds: 3600 })).toBeNull();
  });
});

describe('isIdleTooLong', () => {
  it('is false up to the idle time since the token was issued', () => {
    expect(isIdleTooLong({ now: 5000, issuedAt: 5000, idleSeconds: 300 })).toBe(false);
    expect(isIdleTooLong({ now: 5300, issuedAt: 5000, idleSeconds: 300 })).toBe(false);
  });

  // The token's own expiry holds the idle time it was issued with; this holds
  // the current one, so a shorter setting closes idle sessions at once.
  it('is true past the idle time', () => {
    expect(isIdleTooLong({ now: 5301, issuedAt: 5000, idleSeconds: 300 })).toBe(true);
  });

  it('fails closed on an issue time it cannot read', () => {
    expect(isIdleTooLong({ now: 5000, issuedAt: undefined, idleSeconds: 300 })).toBe(true);
    expect(isIdleTooLong({ now: 5000, issuedAt: 'yesterday', idleSeconds: 300 })).toBe(true);
    expect(isIdleTooLong({ now: 5000, issuedAt: 4999.5, idleSeconds: 300 })).toBe(true);
  });

  it('allows a few seconds of clock difference for a token issued just ahead', () => {
    expect(isIdleTooLong({ now: 5000, issuedAt: 5005, idleSeconds: 300 })).toBe(false);
    expect(isIdleTooLong({ now: 5000, issuedAt: 5120, idleSeconds: 300 })).toBe(true);
  });
});

describe('signInPredatesPassword (ADR-036)', () => {
  const changedAt = new Date('2026-11-11T10:00:00.700Z');
  const changedSec = Math.floor(changedAt.getTime() / 1000);

  it('keeps every sign-in while the password never changed', () => {
    expect(signInPredatesPassword(1, null)).toBe(false);
    expect(signInPredatesPassword(1, undefined)).toBe(false);
  });

  it('ends a sign-in that began before the change', () => {
    expect(signInPredatesPassword(changedSec - 1, changedAt)).toBe(true);
  });

  it('keeps the sign-in made with the change, in the same second, and any after', () => {
    expect(signInPredatesPassword(changedSec, changedAt)).toBe(false);
    expect(signInPredatesPassword(changedSec + 60, changedAt)).toBe(false);
  });

  it('ends a sign-in whose start can\'t be read once a password has changed', () => {
    expect(signInPredatesPassword(null, changedAt)).toBe(true);
  });
});
