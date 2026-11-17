-- An approver may send an adjustment back for changes; whoever asked amends
-- it and sends it again, and every step is kept (ADR-044, FR-INV-WF-001).

-- AlterEnum
ALTER TYPE "AdjustmentRequestStatus" ADD VALUE 'CHANGES_REQUESTED';

-- CreateEnum
CREATE TYPE "AdjustmentRequestEventKind" AS ENUM ('SUBMITTED', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "adjustment_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "kind" "AdjustmentRequestEventKind" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reason_code" "AdjustmentReasonCode" NOT NULL,
    "reason_note" TEXT,
    "recipient_id" TEXT,
    "value" DECIMAL(18,2),

    CONSTRAINT "adjustment_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adjustment_request_events_request_id_at_idx" ON "adjustment_request_events"("request_id", "at");

-- AddForeignKey
ALTER TABLE "adjustment_request_events" ADD CONSTRAINT "adjustment_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "adjustment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_request_events" ADD CONSTRAINT "adjustment_request_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The requests there already: each was asked for, and those decided were
-- approved, rejected, or withdrawn by whoever asked.
INSERT INTO "adjustment_request_events" ("id", "request_id", "kind", "actor_id", "at", "quantity", "reason_code", "reason_note", "recipient_id", "value")
SELECT gen_random_uuid()::text, "id", 'SUBMITTED', "requested_by_id", "requested_at", "quantity", "reason_code", "reason_note", "recipient_id", "value"
FROM "adjustment_requests";

INSERT INTO "adjustment_request_events" ("id", "request_id", "kind", "actor_id", "at", "note", "quantity", "reason_code", "reason_note", "recipient_id", "value")
SELECT gen_random_uuid()::text, "id",
       CASE WHEN "status"::text = 'APPROVED' THEN 'APPROVED'
            WHEN "decided_by_id" = "requested_by_id" THEN 'WITHDRAWN'
            ELSE 'REJECTED' END::"AdjustmentRequestEventKind",
       "decided_by_id", "decided_at", "decision_note", "quantity", "reason_code", "reason_note", "recipient_id", "value"
FROM "adjustment_requests"
WHERE "status"::text IN ('APPROVED', 'REJECTED') AND "decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL;
