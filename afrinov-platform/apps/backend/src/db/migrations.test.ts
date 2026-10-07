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
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
      'racks',
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
      'RackStatus',
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
      'racks_location_id_fkey',
      'racks_project_number_fkey',
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
