-- The room or area a location stands in (racks and locations roadmap, Phase 1).
-- In the stock workbook a rack code ("D-1") and a room ("Stores") share one
-- column and nothing records which room a rack is in. A location may now name
-- its parent: rack "D-1" inside "Main Storeroom". One level only, enforced by
-- the service. Existing locations start with no parent.
ALTER TABLE "locations" ADD COLUMN "parent_id" TEXT;

CREATE INDEX "locations_parent_id_idx" ON "locations"("parent_id");

ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
