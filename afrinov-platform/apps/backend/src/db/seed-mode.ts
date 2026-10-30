// What a seed run is allowed to write (PRA-01).
//
// Every run writes the bootstrap the application needs to work at all:
// permissions, roles, the first administrator and the settings catalog. The
// demo business data (suppliers, materials, projects, purchase orders, stock
// movements) is written only when asked for, and never into production: in
// the system of record it would be fictitious stock that the ledger rules
// (ADR-002, ADR-005) then forbid deleting.
//
// As in loadConfig(), an unset NODE_ENV counts as production, so a
// misconfigured server fails closed instead of loading demo data.

export class SeedModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedModeError';
  }
}

/**
 * Whether this seed run should also write the demo data. Asked for with the
 * `--demo` flag or `SEED_DEMO_DATA=true`.
 *
 * @throws {SeedModeError} when demo data is asked for in production.
 */
export function demoDataRequested(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  const requested = argv.includes('--demo') || String(env.SEED_DEMO_DATA ?? '').toLowerCase() === 'true';
  if (!requested) return false;
  const nodeEnv = env.NODE_ENV ?? 'production';
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new SeedModeError(
      'Demo data is never loaded into production. Set NODE_ENV=development or test for a demo database, ' +
        'or run the seed without --demo / SEED_DEMO_DATA to write only the bootstrap.',
    );
  }
  return true;
}
