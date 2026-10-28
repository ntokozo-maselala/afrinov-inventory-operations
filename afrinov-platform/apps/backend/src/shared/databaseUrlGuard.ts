// Prisma loads `prisma.config.ts` for every CLI invocation, including the
// schema-only commands that run in pretypecheck/pretest/prebuild where
// DATABASE_URL may be absent. The config's datasource falls back to a local
// URL, so a database-touching command must be rejected loudly when the
// variable is missing rather than silently targeting the wrong server.
//
// This lives outside `prisma.config.ts` so the logic can be unit tested: the
// config file is only executed by Prisma's own loader, not by Vitest.

// Commands that never open a connection.
const OFFLINE_COMMANDS = new Set(['generate', 'validate', 'format']);

// Invocations that print information and exit without touching the database.
const INFORMATIONAL_INVOCATIONS = new Set([
  '--help',
  '-h',
  '--version',
  '-v',
  'help',
  'version',
]);

/**
 * Decide whether an invocation needs DATABASE_URL.
 *
 * Only exact informational invocations are exempt. A leading option that is not
 * one of those (for example `prisma --config x migrate deploy`) is treated as a
 * database command, so the guard stays fail-closed for anything unrecognised.
 */
export function requiresDatabaseUrl(argv: readonly string[]): boolean {
  const command = argv[2] ?? '';
  if (INFORMATIONAL_INVOCATIONS.has(command)) return false;
  return !OFFLINE_COMMANDS.has(command);
}
