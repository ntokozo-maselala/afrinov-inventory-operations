-- Transaction reversals: the ledger has no update path, so a mistaken
-- movement is corrected by posting a reversing entry that points at it.
-- The unique index means a transaction can be reversed at most once,
-- even under concurrent requests.

ALTER TABLE "inventory_transactions" ADD COLUMN "reverses_id" TEXT;

CREATE UNIQUE INDEX "inventory_transactions_reverses_id_key" ON "inventory_transactions"("reverses_id");

ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
