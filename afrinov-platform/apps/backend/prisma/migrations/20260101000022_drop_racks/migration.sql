-- Drop the Rack table (racks and locations roadmap, Phase 3.3). A rack is a
-- location of type Rack, inside its room (locations.parent_id). Racks to
-- locations (npm run racks:to-locations, Phase 3.1) copied each Rack's room
-- onto its location, wrote its full record to the audit log and removed it.
--
-- This refuses to run while any Rack row remains, so it can never drop a rack
-- that was not copied: run racks:to-locations on this database (with the
-- version of the app before this migration) until it reports 0 racks.
-- Back up the database before deploying this: it cannot be undone.
DO $$
DECLARE remaining integer;
BEGIN
  SELECT count(*) INTO remaining FROM "racks";
  IF remaining > 0 THEN
    RAISE EXCEPTION 'The racks table still has % row(s). Run npm run racks:to-locations on this database (before this migration) until it reports 0 racks, then migrate again.', remaining;
  END IF;
END $$;

-- The Racks page and API went in Phase 3.2; its permission goes with the table.
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" = 'manage:racks');
DELETE FROM "permissions" WHERE "code" = 'manage:racks';

DROP TABLE "racks";
DROP TYPE "RackStatus";
