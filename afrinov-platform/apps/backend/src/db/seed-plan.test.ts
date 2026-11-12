// What the seed loads (system audit H1): reference data always, demo data only
// when asked for, and never in production.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { SeedPlanError, seedPlan } from './seed-plan.js';

describe('seedPlan', () => {
  it('loads no demo data unless asked', () => {
    expect(seedPlan({ NODE_ENV: 'development' })).toEqual({ demo: false });
    expect(seedPlan({ NODE_ENV: 'test', SEED_DEMO_DATA: '' })).toEqual({ demo: false });
    expect(seedPlan({ NODE_ENV: 'development', SEED_DEMO_DATA: 'false' })).toEqual({ demo: false });
  });

  it('loads demo data when asked, outside production', () => {
    expect(seedPlan({ NODE_ENV: 'development', SEED_DEMO_DATA: 'true' })).toEqual({ demo: true });
    expect(seedPlan({ NODE_ENV: 'test', SEED_DEMO_DATA: ' TRUE ' })).toEqual({ demo: true });
  });

  it('production seeds reference data only, and refuses being asked for demo data', () => {
    expect(seedPlan({ NODE_ENV: 'production' })).toEqual({ demo: false });
    expect(() => seedPlan({ NODE_ENV: 'production', SEED_DEMO_DATA: 'true' })).toThrow(SeedPlanError);
    // NODE_ENV defaults to production, as loadConfig's does.
    expect(() => seedPlan({ SEED_DEMO_DATA: 'true' })).toThrow(/refused in production/);
  });

  it('refuses a value it can\'t read rather than guessing', () => {
    expect(() => seedPlan({ NODE_ENV: 'development', SEED_DEMO_DATA: 'yes' })).toThrow(/true or false/);
  });
});

describe('seed main()', () => {
  // seed.ts runs main() on import, so its order is read from the source: the
  // plan is decided before the first write, and every demo step comes after
  // the early return that skips them.
  const source = readFileSync(join(process.cwd(), 'src', 'db', 'seed.ts'), 'utf8');
  const main = source.slice(source.indexOf('async function main()'));
  const at = (s: string) => main.indexOf(s);

  it('decides the plan before writing anything', () => {
    expect(at('seedPlan()')).toBeGreaterThan(-1);
    expect(at('seedPlan()')).toBeLessThan(at('ensurePermissions()'));
  });

  it.each(['ensureLocations', 'ensureSuppliers', 'ensureMaterials', 'ensureProjects', 'ensureRecipients', 'ensureRackRooms', 'ensurePurchaseOrders', 'ensureGoodsReceipt', 'ensureTransactions'])(
    '%s runs only with demo data on',
    (step) => {
      expect(at(`${step}(`)).toBeGreaterThan(at('if (!plan.demo)'));
    },
  );

  it.each(['ensurePermissions', 'ensureRoles', 'ensureAdminUser', 'SettingsService.ensureSeeded'])('%s always runs', (step) => {
    expect(at(`${step}(`)).toBeGreaterThan(-1);
    expect(at(`${step}(`)).toBeLessThan(at('if (!plan.demo)'));
  });
});
