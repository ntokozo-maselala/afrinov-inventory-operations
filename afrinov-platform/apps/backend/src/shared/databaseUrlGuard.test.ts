// Unit tests for the prisma.config.ts DATABASE_URL guard.
//
// The guard decides whether `prisma.config.ts` throws when DATABASE_URL is
// unset. Getting this wrong in the permissive direction would let a
// database-touching command fall back to the local `afrinov` database, so the
// fail-closed cases are pinned here.
import { describe, it, expect } from 'vitest';
import { requiresDatabaseUrl } from './databaseUrlGuard.js';

const argv = (...args: string[]) => ['node', 'prisma', ...args];

describe('requiresDatabaseUrl', () => {
  it('requires a URL for database-touching commands', () => {
    for (const command of ['migrate', 'db', 'introspect', 'studio']) {
      expect(requiresDatabaseUrl(argv(command))).toBe(true);
    }
  });

  it('does not require a URL for offline commands', () => {
    for (const command of ['generate', 'validate', 'format']) {
      expect(requiresDatabaseUrl(argv(command))).toBe(false);
    }
  });

  it('does not require a URL for informational invocations', () => {
    for (const flag of ['--help', '-h', '--version', '-v', 'help', 'version']) {
      expect(requiresDatabaseUrl(argv(flag))).toBe(false);
    }
  });

  it('treats an unknown command as needing a URL (fail-closed)', () => {
    expect(requiresDatabaseUrl(argv('something-new'))).toBe(true);
    expect(requiresDatabaseUrl(argv())).toBe(true);
  });

  it('keeps a database command behind a leading option fail-closed', () => {
    // Regression: a naive `startsWith('-')` check exempted every leading
    // option, so `prisma --config x migrate deploy` skipped the guard and fell
    // back to the local database.
    expect(requiresDatabaseUrl(argv('--config', 'x', 'migrate', 'deploy'))).toBe(true);
    expect(requiresDatabaseUrl(argv('--schema', 'x', 'migrate', 'reset'))).toBe(true);
  });

  it('does not exempt a database command that carries an informational option', () => {
    // Only the command token (argv[2]) is inspected, so an option after the
    // command does not exempt a database command from the guard.
    expect(requiresDatabaseUrl(argv('migrate', '--help'))).toBe(true);
  });
});
