// Failed sign-ins per account (system audit F4).
import { describe, it, expect } from 'vitest';
import { ACCOUNT_FAILURE_LIMIT, ACCOUNT_FAILURE_WINDOW_MS, createLoginThrottle } from './login-throttle.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('login throttle', () => {
  it('blocks an account after the limit of failures, and only that account', () => {
    const c = clock();
    const throttle = createLoginThrottle(c.now);
    for (let i = 0; i < ACCOUNT_FAILURE_LIMIT - 1; i++) throttle.recordFailure('alice@afrinov.local');
    expect(throttle.isBlocked('alice@afrinov.local')).toBe(false);
    throttle.recordFailure('alice@afrinov.local');
    expect(throttle.isBlocked('alice@afrinov.local')).toBe(true);
    expect(throttle.isBlocked('bob@afrinov.local')).toBe(false);
  });

  it('counts an address in any case or spacing as one account', () => {
    const throttle = createLoginThrottle(clock().now);
    for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) throttle.recordFailure(i % 2 ? ' Alice@Afrinov.local' : 'alice@afrinov.local');
    expect(throttle.isBlocked('ALICE@afrinov.local ')).toBe(true);
  });

  it('forgets failures older than the window', () => {
    const c = clock();
    const throttle = createLoginThrottle(c.now);
    for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) throttle.recordFailure('alice@afrinov.local');
    expect(throttle.isBlocked('alice@afrinov.local')).toBe(true);
    c.advance(ACCOUNT_FAILURE_WINDOW_MS + 1);
    expect(throttle.isBlocked('alice@afrinov.local')).toBe(false);
  });

  it('is cleared by a successful sign-in or a new temporary password', () => {
    const throttle = createLoginThrottle(clock().now);
    for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) throttle.recordFailure('alice@afrinov.local');
    throttle.clear('Alice@afrinov.local');
    expect(throttle.isBlocked('alice@afrinov.local')).toBe(false);
  });
});
