import { describe, expect, it } from 'vitest';
import { requireIsolatedTestDatabaseUrl } from '../../scripts/test-environment.js';

describe('test database guard', () => {
  it('accepts a local PostgreSQL database with the required test suffix', () => {
    const url = 'postgresql://test:test@localhost:5432/afrinov_test?schema=public';
    expect(requireIsolatedTestDatabaseUrl(url)).toBe(url);
  });

  it.each([
    'postgresql://test:test@localhost:5432/afrinov?schema=public',
    'postgresql://test:test@localhost:5432/afrinov_prod_test?schema=public',
    'postgresql://test:test@db.example:5432/afrinov_test?schema=public',
    'postgresql://test:test@localhost:5432/afrinov_test?schema=public&host=prod.example',
    'not a database URL',
  ])('rejects an unsafe or malformed database target without echoing it', (url) => {
    expect(() => requireIsolatedTestDatabaseUrl(url)).toThrow();
    try {
      requireIsolatedTestDatabaseUrl(url);
    } catch (error) {
      expect((error as Error).message).not.toContain(url);
    }
  });
});
