-- Location Management: extend Location with master-data fields, add indexes
-- for the new search/filter use cases, and add an FK-style index on
-- inventory_balances.location_id (already present via the FK index on
-- GoodsReceiptLine / InventoryTransaction / Rack; only balances needs it).
--
-- This migration is idempotent at the column level so it composes cleanly
-- with the `20260101000000_initial` baseline (which already provisions the
-- extended columns). Re-running against a fresh install is a no-op for the
-- columns; the conditional backfill and the indexes remain useful.

-- AlterTable (idempotent: safe to re-run after the initial baseline)
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "code" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_person" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_email" TEXT,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Unique index on the new code column (nullable, so partial index to allow
-- multiple NULLs while still enforcing uniqueness on assigned codes).
-- Use IF NOT EXISTS so re-running on a schema that already has it is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS "locations_code_key" ON "locations"("code") WHERE "code" IS NOT NULL;

-- Indexes supporting list filtering
CREATE INDEX IF NOT EXISTS "locations_type_idx" ON "locations"("type");
CREATE INDEX IF NOT EXISTS "locations_active_idx" ON "locations"("active");

-- Backfill `code` for existing seed rows so the catalogue is consistent.
-- These are the same names the seed script provisions; for unknown legacy
-- rows operators can backfill manually.
UPDATE "locations" SET "code" = 'WH-MAIN'    WHERE "name" = 'Main Storeroom'   AND "code" IS NULL;
UPDATE "locations" SET "code" = 'WS-BOILER'  WHERE "name" = 'Boiler Shop'      AND "code" IS NULL;
UPDATE "locations" SET "code" = 'RACK-D1'    WHERE "name" = 'D-1'              AND "code" IS NULL;
