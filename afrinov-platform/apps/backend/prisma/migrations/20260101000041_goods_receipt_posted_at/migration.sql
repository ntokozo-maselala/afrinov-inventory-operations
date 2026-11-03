-- When a delivery's stock went into the ledger. The received-stock report
-- counts a delivery on that day, as the ledger and the month-end report do,
-- so a delivery note dated earlier than it was booked never changes a month
-- already reported. The delivery note's own date stays in received_at.

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "posted_at" TIMESTAMP(3);

-- Deliveries posted before: when their first RECEIPT was booked, or, with no
-- ledger row to say, when the receipt was recorded.
UPDATE "goods_receipts" gr
SET "posted_at" = t."first_posted"
FROM (
  SELECT "reference_id", MIN("posted_at") AS "first_posted"
  FROM "inventory_transactions"
  WHERE "reference_type" = 'GoodsReceipt' AND "type" = 'RECEIPT' AND "reverses_id" IS NULL
  GROUP BY "reference_id"
) t
WHERE gr."id" = t."reference_id" AND gr."status" = 'POSTED';

UPDATE "goods_receipts" SET "posted_at" = "created_at" WHERE "status" = 'POSTED' AND "posted_at" IS NULL;

-- CreateIndex
CREATE INDEX "goods_receipts_status_posted_at_idx" ON "goods_receipts"("status", "posted_at");
