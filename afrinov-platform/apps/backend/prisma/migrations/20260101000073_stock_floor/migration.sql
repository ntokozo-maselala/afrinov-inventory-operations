-- The stock floor (BR-009, ADR-047): no stored balance is ever below zero.
--
-- Every path that moves stock already refuses a movement that would take a
-- balance below zero, under the balance lock. This constraint is the second
-- layer: if a path ever skips or reorders that check, the database refuses the
-- balance it recomputes instead of keeping it, and the transaction rolls back.
-- It is on the balance, not on ledger lines, so a transfer (−x then +x, then
-- recomputed) is checked only on where it ends.
--
-- Forward-only and additive: no row is changed. One statement, so it applies
-- whole or not at all. It checks for balances already below zero first and
-- refuses with a message naming them (the first ten, and how many there are);
-- if it does, nothing has changed, Prisma records the migration as failed and
-- every later deploy stops (P3009), the previous version's too, and this
-- version's API does not start. Recovery (followed end to end 2026-11-24):
-- `npx prisma migrate resolve --rolled-back 20260101000073_stock_floor`, start
-- the previous version again, correct each balance with an adjustment in it,
-- then install this version again. docs/engineering/DATABASE_ASSURANCE.md,
-- "Stock floor (ADR-047)", has the commands.
--
-- Rollback: prisma/rollbacks/20260101000073_stock_floor.sql drops the
-- constraint and changes no data; this script, run again with
-- `prisma db execute`, puts it back. See docs/engineering/DATABASE_ASSURANCE.md,
-- "Stock floor (ADR-047)".
DO $$
DECLARE
  below_zero integer;
  named text;
BEGIN
  -- No writer can recompute a balance between the check and the constraint.
  LOCK TABLE "inventory_balances" IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO below_zero FROM "inventory_balances" WHERE "quantity" < 0;
  IF below_zero > 0 THEN
    SELECT string_agg(entry, '; ') INTO named FROM (
      SELECT m."sku" || ' at ' || l."name"
               || CASE WHEN b."held_for_project" <> '' THEN ' held for ' || b."held_for_project" ELSE '' END
               || ': ' || trim_scale(b."quantity")::text AS entry
      FROM "inventory_balances" b
      JOIN "materials" m ON m."id" = b."material_id"
      JOIN "locations" l ON l."id" = b."location_id"
      WHERE b."quantity" < 0
      ORDER BY m."sku", l."name", b."held_for_project"
      LIMIT 10
    ) first_ten;
    IF below_zero > 10 THEN named := named || '; and ' || (below_zero - 10) || ' more'; END IF;
    RAISE EXCEPTION
      'inventory_balances has % balance(s) below zero, which BR-009 forbids: %. Nothing was changed. Correct each with an adjustment in the previous version, after clearing this failed migration: docs/engineering/DATABASE_ASSURANCE.md, "Stock floor (ADR-047)".',
      below_zero, named;
  END IF;

  ALTER TABLE "inventory_balances"
    ADD CONSTRAINT "inventory_balances_quantity_non_negative" CHECK ("quantity" >= 0);
END $$;
