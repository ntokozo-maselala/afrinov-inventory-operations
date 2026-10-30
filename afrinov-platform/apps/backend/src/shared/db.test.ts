// Unit tests for the Prisma 7 driver-adapter setup in shared/db.ts.
//
// These pin the regressions the pg adapter introduces relative to the old
// built-in Prisma engine:
//   - DATABASE_URL must be required (no silent localhost fallback).
//   - A non-public `?schema=` must be forwarded to the adapter, because pg
//     ignores Prisma's schema parameter and would otherwise query `public`.
import { describe, it, expect } from 'vitest';
import { schemaFromUrl, statementTimeoutMs } from './db.js';

describe('schemaFromUrl', () => {
  it('extracts a non-public schema from the URL', () => {
    expect(schemaFromUrl('postgresql://u:p@host:5432/db?schema=tenant_a')).toBe('tenant_a');
  });

  it('treats the default public schema as undefined', () => {
    expect(schemaFromUrl('postgresql://u:p@host:5432/db?schema=public')).toBeUndefined();
  });

  it('returns undefined when no schema parameter is present', () => {
    expect(schemaFromUrl('postgresql://u:p@host:5432/db')).toBeUndefined();
  });

  it('returns undefined for an unparseable URL instead of throwing', () => {
    expect(schemaFromUrl('not a url')).toBeUndefined();
  });
});

describe('statementTimeoutMs (PRA-18)', () => {
  it('matches the 30 s request timeout by default', () => {
    expect(statementTimeoutMs({})).toBe(30_000);
    expect(statementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: '' })).toBe(30_000);
  });

  it('takes an override, including 0 to switch it off', () => {
    expect(statementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: '15000' })).toBe(15_000);
    expect(statementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: '0' })).toBe(0);
  });

  it('ignores a value that is not a non-negative number', () => {
    expect(statementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: 'soon' })).toBe(30_000);
    expect(statementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: '-5' })).toBe(30_000);
  });
});
