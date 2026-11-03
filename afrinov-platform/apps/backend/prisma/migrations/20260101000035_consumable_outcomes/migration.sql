-- Used up or broken: what became of a tracked consumable after it was issued
-- (04-processes/stock-issuing.md, ADR-026).
--
-- An item switched to track use (a disc, a blade, a bit) has each issue line
-- closed off later as used up or broken, when the stub or the broken piece
-- comes back. Nothing here moves stock: it left the shelf at the issue. Rows
-- are only ever added; a mistake is withdrawn by a row naming it. Every item
-- starts untracked, so nothing changes until someone switches one on.

-- CreateEnum
CREATE TYPE "ConsumableOutcomeKind" AS ENUM ('USED_UP', 'BROKEN');

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "track_use" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "consumable_outcomes" (
    "id" TEXT NOT NULL,
    "issue_transaction_id" TEXT NOT NULL,
    "outcome" "ConsumableOutcomeKind" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "note" TEXT,
    "withdraws_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumable_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consumable_outcomes_withdraws_id_key" ON "consumable_outcomes"("withdraws_id");

-- CreateIndex
CREATE INDEX "consumable_outcomes_issue_transaction_id_idx" ON "consumable_outcomes"("issue_transaction_id");

-- AddForeignKey
ALTER TABLE "consumable_outcomes" ADD CONSTRAINT "consumable_outcomes_issue_transaction_id_fkey" FOREIGN KEY ("issue_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumable_outcomes" ADD CONSTRAINT "consumable_outcomes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumable_outcomes" ADD CONSTRAINT "consumable_outcomes_withdraws_id_fkey" FOREIGN KEY ("withdraws_id") REFERENCES "consumable_outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

