// Migration baseline regression test.
//
// Goal: protect the database schema from accidental drift. We assert
// the migrations folder contains the `20260101000000_initial` migration
// and that it provisions every table, enum, and foreign key referenced
// by the live Prisma schema. If a future change drops a required object
// (a table referenced by a reporting or settings endpoint, for example)
// this test will fail before the broken state reaches the database.
//
// The test is intentionally framework-free: it reads the migration
// files from disk and greps for the expected DDL. The actual migration
// runner (`prisma migrate deploy`) is exercised by the integration
// pipeline against a real Postgres.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The settings catalog is read, never the database.
vi.mock('../shared/db.js', () => ({ prisma: {} }));
const { SETTING_CATALOG } = await import('../modules/settings/settings.service.js');


const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function readMigration(name: string): string {
  const path = join(MIGRATIONS_DIR, name, 'migration.sql');
  if (!existsSync(path)) throw new Error(`Missing migration: ${name}`);
  return readFileSync(path, 'utf8');
}

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => existsSync(join(MIGRATIONS_DIR, f, 'migration.sql')))
    .sort();
}

describe('Prisma migrations baseline', () => {
  it('has an initial migration that creates the schema', () => {
    const sql = readMigration('20260101000000_initial');
    // Every table referenced by a live endpoint must be created here.
    const requiredTables = [
      'users',
      'user_roles',
      'roles',
      'permissions',
      'role_permissions',
      'materials',
      'locations',
      'suppliers',
      'projects',
      'purchase_orders',
      'purchase_order_lines',
      'goods_receipts',
      'goods_receipt_lines',
      'inventory_transactions',
      'inventory_balances',
      'settings',
      'audit_log_entries',
    ];
    for (const table of requiredTables) {
      const re = new RegExp(`CREATE TABLE "${table}"`, 'i');
      expect(sql, `initial migration must create "${table}"`).toMatch(re);
    }
  });

  it('creates every enum referenced by the schema', () => {
    const sql = readMigration('20260101000000_initial');
    const requiredEnums = [
      'RoleName',
      'MaterialCategory',
      'LocationType',
      'PurchaseOrderStatus',
      'GoodsReceiptStatus',
      'InventoryTransactionType',
      'AdjustmentReasonCode',
      'SettingType',
      'SettingCategory',
    ];
    for (const e of requiredEnums) {
      const re = new RegExp(`CREATE TYPE "${e}"`, 'i');
      expect(sql, `initial migration must create enum "${e}"`).toMatch(re);
    }
  });

  it('declares every foreign key required by the application', () => {
    const sql = readMigration('20260101000000_initial');
    // Spot-check a handful of FKs that the report / settings / inventory
    // queries depend on. A new FK added to the schema must end up here.
    const requiredFks = [
      'user_roles_user_id_fkey',
      'user_roles_role_id_fkey',
      'role_permissions_role_id_fkey',
      'role_permissions_permission_id_fkey',
      'purchase_orders_supplier_id_fkey',
      'purchase_orders_created_by_id_fkey',
      'purchase_order_lines_purchase_order_id_fkey',
      'purchase_order_lines_material_id_fkey',
      'goods_receipt_lines_goods_receipt_id_fkey',
      'goods_receipt_lines_material_id_fkey',
      'goods_receipt_lines_location_id_fkey',
      'inventory_transactions_material_id_fkey',
      'inventory_transactions_location_id_fkey',
      'inventory_transactions_actor_id_fkey',
      'inventory_transactions_paired_with_id_fkey',
      'inventory_transactions_project_number_fkey',
      'settings_updated_by_id_fkey',
      'projects_manager_id_fkey',
    ];
    for (const fk of requiredFks) {
      expect(sql, `initial migration must declare "${fk}"`).toContain(fk);
    }
  });

  it('adds the indexes that reporting and inventory endpoints rely on', () => {
    const sql = readMigration('20260101000000_initial');
    const requiredIndexes = [
      'materials_category_idx',
      'materials_active_idx',
      'locations_type_idx',
      'locations_active_idx',
      'purchase_orders_status_idx',
      'purchase_orders_supplier_id_idx',
      'inventory_transactions_material_id_location_id_posted_at_idx',
      'inventory_transactions_posted_at_idx',
      'inventory_transactions_type_idx',
      'inventory_balances_location_id_idx',
      'settings_category_idx',
    ];
    for (const idx of requiredIndexes) {
      const re = new RegExp(`CREATE INDEX "${idx}"`, 'i');
      expect(sql, `initial migration must create index "${idx}"`).toMatch(re);
    }
  });

  it('declares unique constraints that the app depends on', () => {
    const sql = readMigration('20260101000000_initial');
    const requiredUniques = [
      'users_email_key',
      'roles_name_key',
      'permissions_code_key',
      'materials_sku_key',
      'locations_name_key',
      'purchase_orders_number_key',
      'goods_receipts_number_key',
      'inventory_transactions_paired_with_id_key',
    ];
    for (const u of requiredUniques) {
      const re = new RegExp(`CREATE UNIQUE INDEX "${u}"`, 'i');
      expect(sql, `initial migration must declare unique "${u}"`).toMatch(re);
    }
  });

  it('is alphabetically first so the runner applies it before any feature migration', () => {
    const order = listMigrations();
    expect(order[0]).toBe('20260101000000_initial');
  });

  it('the location_management migration is idempotent so it composes with the baseline', () => {
    const sql = readMigration('20260101000001_location_management');
    // Every ALTER TABLE / CREATE INDEX in this migration must be a
    // no-op on a fresh install whose `locations` table was created by
    // the baseline migration (which already includes these columns).
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });
});

describe('dropping the Rack table (racks and locations roadmap, Phase 3.3)', () => {
  it('refuses to drop it while any Rack row remains, then drops the table, its type and its permission', () => {
    const sql = readMigration('20260101000022_drop_racks');
    // The guard comes first, so a database whose racks were not copied is never changed.
    const guard = sql.indexOf('RAISE EXCEPTION');
    expect(guard).toBeGreaterThan(-1);
    // The table is locked before it is counted, and the count and the drop are one DO block,
    // so no rack can be added between them.
    const lock = sql.indexOf('LOCK TABLE "racks" IN ACCESS EXCLUSIVE MODE');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(sql.indexOf('SELECT count(*) INTO remaining'));
    const block = sql.slice(sql.indexOf('DO $'), sql.lastIndexOf('END $'));
    expect(block).toContain('DROP TABLE "racks"');
    expect(block).toContain('DROP TYPE "RackStatus"');
    expect(sql).toContain('SELECT count(*) INTO remaining FROM "racks"');
    expect(guard).toBeLessThan(sql.indexOf('DROP TABLE "racks"'));
    expect(sql).toContain('DROP TYPE "RackStatus"');
    expect(sql).toContain("DELETE FROM \"permissions\" WHERE \"code\" = 'manage:racks'");
  });
});

describe('stock held for a project (project material through the store roadmap, Phase 1)', () => {
  it('keys balances by project too, keeps existing stock as Stores stock, and protects a project holding stock', () => {
    const sql = readMigration('20260101000035_stock_held_for_project');
    // One Stores balance ('') per item and location, and one per project.
    expect(sql).toContain('ADD COLUMN     "held_for_project" TEXT NOT NULL DEFAULT \'\'');
    expect(sql).toContain('PRIMARY KEY ("material_id", "location_id", "held_for_project")');
    // Movements say whose stock they are; null (Stores) for every one from before.
    expect(sql).toContain('ALTER TABLE "inventory_transactions" ADD COLUMN     "held_for_project" TEXT;');
    // Nothing is back-filled, so every balance keeps its quantity.
    expect(sql).not.toMatch(/^\s*UPDATE\b/im);
    // A project with stock held for it can't be deleted or renumbered under its balances.
    expect(sql).toContain('REFERENCES "projects"("project_number") ON DELETE RESTRICT ON UPDATE RESTRICT');
  });
});

describe('project schedules (project tracking roadmap, Phase 1)', () => {
  it('only adds, keeps a project with schedules from being deleted or renumbered, and gives Admin the permission', () => {
    const sql = readMigration('20260101000052_project_schedules');
    expect(sql).not.toMatch(/\b(DROP|ALTER COLUMN|DELETE FROM)\b/i);
    expect(sql).toContain('REFERENCES "projects"("project_number") ON DELETE RESTRICT ON UPDATE RESTRICT');
    expect(sql).toMatch(/'manage:project_schedule'[\s\S]*r\."name" = 'ADMIN'/);
    // The new category is added on its own: Postgres can't use an enum value in the transaction that adds it.
    expect(readMigration('20260101000051_projects_setting_category').trim().split('\n').filter((l) => !l.startsWith('--')))
      .toEqual([`ALTER TYPE "SettingCategory" ADD VALUE IF NOT EXISTS 'projects';`]);
  });
});

// A new setting needs its row on databases that already exist: the seed adds
// rows only where it runs, and Settings can neither show nor save a setting
// without one (Project Material Through the Store Roadmap, Phase 4).
describe('settings rows', () => {
  // The settings in the initial commit's catalog, which the first seed created
  // before each new one came with a migration.
  const SEEDED_FIRST = new Set([
    'general.companyName', 'general.systemDescription', 'general.defaultCurrency', 'general.dateFormat', 'general.timeFormat',
    'general.defaultPageSize', 'general.defaultLandingPage',
    'inventory.defaultUnitOfMeasure', 'inventory.enableStockAlerts', 'purchaseOrders.requireApprovalBeforeProcessing',
    'purchaseOrders.allowCancellation', 'purchaseOrders.allowEditAfterApproval', 'notifications.enableInAppNotifications',
    'notifications.enableLowStockNotifications', 'notifications.enablePurchaseOrderNotifications',
    'appearance.theme', 'appearance.density', 'security.sessionTimeoutMinutes',
  ]);

  /**
   * The keys of the rows an INSERT INTO "settings" adds. Only an insert gives
   * a setting its row: an UPDATE naming a key changes a row that must already
   * be there (Qodo, PR #147).
   */
  function insertedSettingKeys(sql: string): Set<string> {
    const keys = new Set<string>();
    for (const insert of sql.matchAll(/INSERT INTO "settings"[\s\S]*?;/g)) {
      for (const row of insert[0].matchAll(/\(\s*'([A-Za-z0-9.]+)'/g)) keys.add(row[1]!);
    }
    return keys;
  }

  it('reads only inserted rows, not a key an UPDATE names', () => {
    expect([...insertedSettingKeys(`UPDATE "settings" SET "description" = 'x' WHERE "key" = 'a.updated';`)]).toEqual([]);
    expect([...insertedSettingKeys(`INSERT INTO "settings" ("key", "value") VALUES\n  ('a.one', '1'),\n  ('a.two', '2')\nON CONFLICT ("key") DO NOTHING;`)])
      .toEqual(['a.one', 'a.two']);
  });

  it('inserts every setting added since the first seed in a migration', () => {
    const inserted = insertedSettingKeys(listMigrations().map(readMigration).join('\n'));
    const missing = SETTING_CATALOG.map((d) => d.key).filter((k) => !SEEDED_FIRST.has(k) && !inserted.has(k));
    expect(missing).toEqual([]);
  });
});

// Settings that do nothing (requirements gap, 11 Nov 2026): seven settings
// nothing read are retired, and the two kept say what they now do.
describe('retiring the settings nothing read (migration 54)', () => {
  const RETIRED = [
    'general.systemDescription', 'general.dateFormat', 'general.timeFormat', 'general.defaultPageSize',
    'notifications.enableInAppNotifications', 'notifications.enableLowStockNotifications',
    'notifications.enablePurchaseOrderNotifications',
  ];
  const sql = readMigration('20260101000054_retire_unread_settings');
  const statements = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('changes data only, never the schema', () => {
    expect(statements).not.toMatch(/\b(CREATE|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('deletes the rows of exactly the retired settings, which the catalogue no longer has', () => {
    const deletes = [...statements.matchAll(/DELETE FROM "settings"[\s\S]*?;/g)].map((m) => m[0]);
    expect(deletes).toHaveLength(1);
    const keys = [...deletes[0]!.matchAll(/'([A-Za-z0-9.]+)'/g)].map((m) => m[1]).sort();
    expect(keys).toEqual([...RETIRED].sort());
    const catalogue = new Set(SETTING_CATALOG.map((d) => d.key));
    expect(RETIRED.filter((k) => catalogue.has(k))).toEqual([]);
  });

  // List reads a setting's description from its row, and the seed never
  // rewrites a row, so the page says what the catalogue says only if this does.
  it.each(['security.sessionTimeoutMinutes', 'inventory.defaultUnitOfMeasure'])('gives %s its description from the catalogue', (key) => {
    const description = SETTING_CATALOG.find((d) => d.key === key)!.description;
    expect(statements).toContain(`SET "description" = '${description.replace(/'/g, "''")}'`);
    expect(statements).toContain(`WHERE "key" = '${key}'`);
  });

  it('puts a default unit not on the list onto a listed one, by its spelling or else each', () => {
    expect(statements).toMatch(/UPDATE "settings"[\s\S]*"units_of_measure"[\s\S]*"active"[\s\S]*'inventory\.defaultUnitOfMeasure'/);
    expect(statements).toMatch(/to_jsonb\('each'::text\)/);
  });
});
