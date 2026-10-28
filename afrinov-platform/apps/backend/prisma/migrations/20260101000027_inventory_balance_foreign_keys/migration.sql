-- Add the two foreign keys the Prisma schema declares for inventory_balances
-- but which the initial migration never created (DATA-03). Without them an
-- out-of-band write or an application defect can leave a balance row whose
-- material or location no longer exists, and reports then show stock against a
-- deleted item.
--
-- Forward-only and additive: no existing column or row is changed. It refuses
-- to run while any orphan row remains, so it can never fail halfway on a
-- populated database and leave the migration recorded as failed (P3009). If it
-- refuses, delete or repair the orphan rows it names and deploy again.
DO $$
DECLARE
  orphan_material integer;
  orphan_location integer;
BEGIN
  -- Lock the table so no writer can create a new orphan between the check and
  -- the constraint creation (mirrors 20260101000022_drop_racks).
  LOCK TABLE "inventory_balances" IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO orphan_material
    FROM "inventory_balances" b
    WHERE NOT EXISTS (SELECT 1 FROM "materials" m WHERE m."id" = b."material_id");
  SELECT count(*) INTO orphan_location
    FROM "inventory_balances" b
    WHERE NOT EXISTS (SELECT 1 FROM "locations" l WHERE l."id" = b."location_id");

  IF orphan_material > 0 OR orphan_location > 0 THEN
    RAISE EXCEPTION
      'inventory_balances has % orphan material row(s) and % orphan location row(s). Resolve them before adding the foreign keys, then deploy again. See docs/engineering/DATABASE_ASSURANCE.md, "DATA-03".',
      orphan_material, orphan_location;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_balances_material_id_fkey') THEN
    ALTER TABLE "inventory_balances"
      ADD CONSTRAINT "inventory_balances_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_balances_location_id_fkey') THEN
    ALTER TABLE "inventory_balances"
      ADD CONSTRAINT "inventory_balances_location_id_fkey"
      FOREIGN KEY ("location_id") REFERENCES "locations"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
