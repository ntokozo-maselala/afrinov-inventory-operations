-- Issue slips: the lines one issue posts share an issue id (and its time), so
-- the Issued stock report can show them together. Nothing recorded which
-- earlier lines were issued together, so each earlier issue line becomes a
-- one-line slip. Reversals are not part of a slip.
ALTER TABLE "inventory_transactions" ADD COLUMN "issue_id" TEXT;

UPDATE "inventory_transactions" SET "issue_id" = "id" WHERE "type" = 'ISSUE' AND "reverses_id" IS NULL;

CREATE INDEX "inventory_transactions_issue_id_idx" ON "inventory_transactions"("issue_id");
