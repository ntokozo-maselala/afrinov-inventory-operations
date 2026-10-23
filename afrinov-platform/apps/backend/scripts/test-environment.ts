import { existsSync, readFileSync } from 'node:fs';

/** Load only the test-only environment file. Existing shell variables win. */
export function loadTestEnvironmentFile(file = `${process.cwd()}/.env.test`): void {
  if (!existsSync(file)) return;

  const contents = readFileSync(file, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1]!;
    if (process.env[key] !== undefined) continue;

    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Accept only local PostgreSQL databases with an explicit `_test` suffix.
 * The URL is never included in errors because it may contain credentials.
 */
export function requireIsolatedTestDatabaseUrl(value = process.env.DATABASE_URL): string {
  if (!value) {
    throw new Error('DATABASE_URL is required. Configure a disposable database in apps/backend/.env.test.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL; its value was not displayed.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Database-backed tests require PostgreSQL.');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLoopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!isLoopback) {
    throw new Error('Database-backed tests are restricted to a local PostgreSQL service.');
  }

  // Do not let libpq-style overrides redirect a URL whose authority looks
  // local to a remote endpoint. Prisma normally rejects unsupported options,
  // but the guard must not depend on connector-specific parsing behavior.
  if (['host', 'hostaddr', 'service'].some((key) => parsed.searchParams.has(key))) {
    throw new Error('Database-backed tests must use the URL host directly, without host overrides.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const namesProduction = /(^|[_-])prod(?:uction)?([_-]|$)/i.test(databaseName);
  if (!databaseName.endsWith('_test') || namesProduction) {
    throw new Error('Database-backed tests require a disposable database whose name ends in _test.');
  }

  return value;
}
