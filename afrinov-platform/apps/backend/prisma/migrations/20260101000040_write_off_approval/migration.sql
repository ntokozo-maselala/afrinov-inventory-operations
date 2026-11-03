-- Write-offs and other adjustments worth more than
-- inventory.writeOffApprovalAbove wait for someone other than whoever asked
-- for them (segregation of duties). Nothing moves until approval posts the
-- ADJUSTMENT; a rejection posts nothing. Approving takes approve:write_off,
-- granted to the store controller and Admin here so existing databases get it
-- without re-running the seed.

-- CreateEnum
CREATE TYPE "AdjustmentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "adjustment_requests" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "held_for_project" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reason_code" "AdjustmentReasonCode" NOT NULL,
    "reason_note" TEXT,
    "recipient_id" TEXT,
    "value" DECIMAL(18,2),
    "status" "AdjustmentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "transaction_id" TEXT,

    CONSTRAINT "adjustment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_requests_transaction_id_key" ON "adjustment_requests"("transaction_id");

-- CreateIndex
CREATE INDEX "adjustment_requests_status_requested_at_idx" ON "adjustment_requests"("status", "requested_at");

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'approve:write_off', 'approve:write_off')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."name" IN ('STORE_CONTROLLER', 'ADMIN') AND p."code" = 'approve:write_off'
ON CONFLICT DO NOTHING;

INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "enum_options", "updated_at")
VALUES
  ('inventory.requireWriteOffApproval', 'true', 'boolean', 'inventory',
   'When on, adjustments and write-offs worth more than the limit below wait for someone other than whoever asked for them to approve them. When off, every adjustment posts at once.',
   true, NULL, CURRENT_TIMESTAMP),
  ('inventory.writeOffApprovalAbove', '1000', 'number', 'inventory',
   'Adjustments and write-offs worth more than this, in rand at the item''s unit cost, wait for someone else to approve them before stock moves. An item with no unit cost always waits. 0: every adjustment waits.',
   true, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
