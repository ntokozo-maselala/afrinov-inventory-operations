-- Project material is issued only on the Workshop Manager's approval, or the
-- Director standing in (ADR-043).

-- CreateEnum
CREATE TYPE "IssueRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ReceiptMethod" ADD VALUE 'APPROVAL';


-- CreateTable
CREATE TABLE "issue_requests" (
    "id" TEXT NOT NULL,
    "project_number" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "note" TEXT,
    "status" "IssueRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "stand_in" BOOLEAN NOT NULL DEFAULT false,
    "issue_id" TEXT,

    CONSTRAINT "issue_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_request_lines" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "material_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "approved_quantity" DECIMAL(18,4),

    CONSTRAINT "issue_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "issue_requests_issue_id_key" ON "issue_requests"("issue_id");

-- CreateIndex
CREATE INDEX "issue_requests_status_requested_at_idx" ON "issue_requests"("status", "requested_at");

-- CreateIndex
CREATE INDEX "issue_requests_project_number_status_idx" ON "issue_requests"("project_number", "status");

-- CreateIndex
CREATE INDEX "issue_request_lines_material_id_location_id_idx" ON "issue_request_lines"("material_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_request_lines_request_id_line_no_key" ON "issue_request_lines"("request_id", "line_no");

-- AddForeignKey
ALTER TABLE "issue_requests" ADD CONSTRAINT "issue_requests_project_number_fkey" FOREIGN KEY ("project_number") REFERENCES "projects"("project_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_requests" ADD CONSTRAINT "issue_requests_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_requests" ADD CONSTRAINT "issue_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_requests" ADD CONSTRAINT "issue_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_request_lines" ADD CONSTRAINT "issue_request_lines_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "issue_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_request_lines" ADD CONSTRAINT "issue_request_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_request_lines" ADD CONSTRAINT "issue_request_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A line asks for something, and approval gives at most that (0 leaves it out).
ALTER TABLE "issue_request_lines" ADD CONSTRAINT "issue_request_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "issue_request_lines" ADD CONSTRAINT "issue_request_lines_approved_within"
  CHECK ("approved_quantity" IS NULL OR ("approved_quantity" >= 0 AND "approved_quantity" <= "quantity"));

-- A request is decided once, and only an approved one has a slip.
ALTER TABLE "issue_requests" ADD CONSTRAINT "issue_requests_decided"
  CHECK (("status" = 'PENDING') = ("decided_at" IS NULL));
ALTER TABLE "issue_requests" ADD CONSTRAINT "issue_requests_slip_when_approved"
  CHECK (("status" = 'APPROVED') = ("issue_id" IS NOT NULL));

-- An approved project slip is confirmed by its approval: no one who collected
-- is named, and the approver is captured_by. The new value is compared as text,
-- as an enum value added in this transaction can't be used yet.
ALTER TABLE "receipt_confirmations" DROP CONSTRAINT "receipt_confirmations_confirmed_has_signer";
ALTER TABLE "receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_confirmed_has_signer"
  CHECK ("method"::text = 'NONE'
    OR ("method"::text = 'APPROVAL' AND "signer_id" IS NULL AND "lines_fingerprint" IS NOT NULL AND "reason" IS NULL)
    OR ("method"::text <> 'APPROVAL' AND "signer_id" IS NOT NULL AND "lines_fingerprint" IS NOT NULL AND "reason" IS NULL));

-- Approving project issues: the Workshop Manager, and the Director standing in.
INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'approve:project_issue', 'approve:project_issue')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."name"::text IN ('ADMIN', 'WORKSHOP_MANAGER', 'DIRECTOR') AND p."code" = 'approve:project_issue'
ON CONFLICT DO NOTHING;
