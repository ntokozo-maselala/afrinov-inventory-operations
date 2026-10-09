-- Simplify the purchase-order lifecycle to
--   DRAFT -> PENDING_APPROVAL -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED
-- with CANCELLED before anything is received. Removed statuses are mapped:
--   SUBMITTED              -> PENDING_APPROVAL
--   SENT, SHIPPED          -> APPROVED  (nothing received yet)
--   DELIVERED, FULLY_RECEIVED -> RECEIVED
--   REJECTED               -> CANCELLED (reason kept, or "Rejected")
-- The shipped_* columns are kept, unused, so older records keep their history.

UPDATE "purchase_orders"
SET "cancellation_reason" = COALESCE("cancellation_reason", 'Rejected')
WHERE "status" = 'REJECTED';

ALTER TYPE "PurchaseOrderStatus" RENAME TO "PurchaseOrderStatus_old";

CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

ALTER TABLE "purchase_orders" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "purchase_orders" ALTER COLUMN "status" TYPE "PurchaseOrderStatus" USING (
  CASE "status"::text
    WHEN 'SUBMITTED' THEN 'PENDING_APPROVAL'
    WHEN 'SENT' THEN 'APPROVED'
    WHEN 'SHIPPED' THEN 'APPROVED'
    WHEN 'DELIVERED' THEN 'RECEIVED'
    WHEN 'FULLY_RECEIVED' THEN 'RECEIVED'
    WHEN 'REJECTED' THEN 'CANCELLED'
    ELSE "status"::text
  END
)::"PurchaseOrderStatus";

ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "PurchaseOrderStatus_old";

-- Closing an order: closing short (some lines not fully received) needs a reason.
ALTER TABLE "purchase_orders" ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "closed_by_id" TEXT,
ADD COLUMN "close_reason" TEXT;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
