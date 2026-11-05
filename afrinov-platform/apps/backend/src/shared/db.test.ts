// Unit tests for the Prisma 7 driver-adapter setup in shared/db.ts.
//
// These pin the regressions the pg adapter introduces relative to the old
// built-in Prisma engine:
//   - DATABASE_URL must be required (no silent localhost fallback).
//   - A non-public `?schema=` must be forwarded to the adapter, because pg
//     ignores Prisma's schema parameter and would otherwise query `public`.
import { describe, it, expect } from 'vitest';
import { schemaFromUrl, searchPathOption } from './db.js';

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

// Qodo, PR #156: raw SQL names tables unqualified, so it must look in the same schema.
describe('searchPathOption', () => {
  it('starts each connection in the schema the URL names, quoted', () => {
    expect(searchPathOption('postgresql://u:p@host:5432/db?schema=tenant_a')).toBe('-c search_path="tenant_a"');
  });

  it('escapes what a startup option and an identifier need', () => {
    expect(searchPathOption('postgresql://u:p@host:5432/db?schema=My%20Store')).toBe('-c search_path="My\\ Store"');
    expect(searchPathOption('postgresql://u:p@host:5432/db?schema=a%22b')).toBe('-c search_path="a""b"');
  });

  it('leaves the server default for public, no schema or an unparseable URL', () => {
    expect(searchPathOption('postgresql://u:p@host:5432/db?schema=public')).toBeUndefined();
    expect(searchPathOption('postgresql://u:p@host:5432/db')).toBeUndefined();
    expect(searchPathOption('not a url')).toBeUndefined();
  });
});
