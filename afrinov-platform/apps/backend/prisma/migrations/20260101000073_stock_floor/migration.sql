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
-- refuses with a message naming them; if it does, Prisma records the migration
-- as failed (P3009). Correct each balance with an adjustment
-- (`npm run check:issued-stock` lists them), then
-- `npx prisma migrate resolve --rolled-back 20260101000073_stock_floor`
-- and deploy again.
--
-- Rollback: prisma/rollbacks/20260101000073_stock_floor.sql drops the
-- constraint and changes no data; this script, run again with
-- `prisma db execute`, puts it back. See docs/engineering/DATABASE_ASSURANCE.md,
-- "Stock floor (ADR-047)".
DO $$
DECLARE
  below_zero integer;
BEGIN
  -- No writer can recompute a balance between the check and the constraint.
  LOCK TABLE "inventory_balances" IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO below_zero FROM "inventory_balances" WHERE "quantity" < 0;
  IF below_zero > 0 THEN
    RAISE EXCEPTION
      'inventory_balances has % balance(s) below zero, which BR-009 forbids. Correct each with an adjustment (npm run check:issued-stock lists them), run prisma migrate resolve --rolled-back 20260101000073_stock_floor, then deploy again. See docs/engineering/DATABASE_ASSURANCE.md, "Stock floor (ADR-047)".',
      below_zero;
  END IF;

  ALTER TABLE "inventory_balances"
    ADD CONSTRAINT "inventory_balances_quantity_non_negative" CHECK ("quantity" >= 0);
END $$;
