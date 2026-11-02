-- Stock is held for a project (Project Material Through the Store Roadmap,
-- Phase 1). Each movement records whose stock it is, the project it is held
-- for or null for Stores stock, and balances are kept per item, location and
-- project, so the same item can be held for two projects at one location.
--
-- Nothing is back-filled: every existing movement stays Stores stock (null),
-- and every existing balance gets '' (Stores), so each balance keeps the same
-- quantity and nothing changes on screen. Leftovers still take their project
-- from the item until a later phase moves them onto the stock.

-- AlterTable
ALTER TABLE "inventory_balances" DROP CONSTRAINT "inventory_balances_pkey",
ADD COLUMN     "held_for_project" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("material_id", "location_id", "held_for_project");

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "held_for_project" TEXT;

-- CreateIndex
CREATE INDEX "inventory_transactions_material_id_location_id_held_for_pro_idx" ON "inventory_transactions"("material_id", "location_id", "held_for_project");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_held_for_project_fkey" FOREIGN KEY ("held_for_project") REFERENCES "projects"("project_number") ON DELETE RESTRICT ON UPDATE RESTRICT;
