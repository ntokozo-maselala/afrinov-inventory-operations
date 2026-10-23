-- Drop the Rack table (racks and locations roadmap, Phase 3.3). A rack is a
-- location of type Rack, inside its room (locations.parent_id). Racks to
-- locations (npm run racks:to-locations, Phase 3.1) copied each Rack's room
-- onto its location, wrote its full record to the audit log and removed it.
--
-- This refuses to run while any Rack row remains, so it can never drop a rack
-- that was not copied. Back up the database before deploying it: it cannot be
-- undone. If it refuses, Prisma records it as failed and later deploys stop
-- (P3009) until it is resolved; the recovery steps are in the backend README,
-- "Dropping the Rack table": copy the racks with racks:to-locations from the
-- release before this one (main at e7ad3b5, which still has the command),
-- then `npx prisma migrate resolve --rolled-back 20260101000022_drop_racks`,
-- then deploy again.
--
-- One DO block, so the check and the drop are one statement, all or nothing,
-- however the migration runner handles transactions. It first locks the
-- table against every other reader and writer (ACCESS EXCLUSIVE), so no rack
-- can be added between counting them and dropping the table.
DO $$
DECLARE remaining integer;
BEGIN
  LOCK TABLE "racks" IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO remaining FROM "racks";
  IF remaining > 0 THEN
    RAISE EXCEPTION 'The racks table still has % row(s), so nothing was dropped. Copy them first with npm run racks:to-locations from the release before this one (main at e7ad3b5), then run: npx prisma migrate resolve --rolled-back 20260101000022_drop_racks, and deploy again. See the backend README, "Dropping the Rack table".', remaining;
  END IF;

  -- The Racks page and API went in Phase 3.2; its permission goes with the table.
  DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" = 'manage:racks');
  DELETE FROM "permissions" WHERE "code" = 'manage:racks';

  DROP TABLE "racks";
  DROP TYPE "RackStatus";
END $$;
