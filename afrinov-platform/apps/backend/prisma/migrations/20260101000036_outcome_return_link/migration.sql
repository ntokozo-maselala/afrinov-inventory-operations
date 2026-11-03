-- ADR-026: every counter visit is on Movements. A used up or broken mark
-- booked in the same visit as a return points at that RETURN, so the return's
-- row shows it; a mark with no return is a row of its own. Earlier marks have
-- none and are listed on their own.
-- AlterTable
ALTER TABLE "consumable_outcomes" ADD COLUMN     "return_transaction_id" TEXT;

-- CreateIndex
CREATE INDEX "consumable_outcomes_return_transaction_id_idx" ON "consumable_outcomes"("return_transaction_id");

-- CreateIndex
CREATE INDEX "consumable_outcomes_created_at_idx" ON "consumable_outcomes"("created_at");

-- AddForeignKey
ALTER TABLE "consumable_outcomes" ADD CONSTRAINT "consumable_outcomes_return_transaction_id_fkey" FOREIGN KEY ("return_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
