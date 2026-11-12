// What the seed loads (system audit H1). Reference data the application needs
// (permissions, roles, the first admin, settings) always; the demo business
// (items, suppliers, projects, orders and a demo ledger) only when asked for
// with SEED_DEMO_DATA=true, and never in production: the ledger can only be
// added to, so demo stock there could never be taken out, and the one-time
// workbook import refuses a database whose item codes already exist.

export class SeedPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedPlanError';
  }
}

export interface SeedPlan {
  demo: boolean;
}

export function seedPlan(env: NodeJS.ProcessEnv = process.env): SeedPlan {
  const flag = String(env.SEED_DEMO_DATA ?? '').trim().toLowerCase();
  if (flag !== '' && flag !== 'true' && flag !== 'false') {
    throw new SeedPlanError(`SEED_DEMO_DATA must be true or false (got "${env.SEED_DEMO_DATA}").`);
  }
  const demo = flag === 'true';
  if (demo && (env.NODE_ENV ?? 'production') === 'production') {
    throw new SeedPlanError('SEED_DEMO_DATA=true is refused in production: demo stock could never be removed from the ledger. Nothing was seeded.');
  }
  return { demo };
}
