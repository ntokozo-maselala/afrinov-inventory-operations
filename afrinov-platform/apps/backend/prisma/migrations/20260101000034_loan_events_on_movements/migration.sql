-- Tool loan events on Movements (04-processes/tool-loans.md, ADR-025).
--
-- Why a tool was lent to someone with an overdue one moves from the audit log
-- to the check-out itself, so Movements can show it. Due date changes are
-- listed on Movements newest first, so they get an index on when they were made.

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "overdue_override_reason" TEXT;

-- CreateIndex
CREATE INDEX "tool_loan_extensions_created_at_idx" ON "tool_loan_extensions"("created_at");

-- Check-outs posted before this migration kept the reason only in their audit
-- entry (TOOL_CHECK_OUT, entity = the slip). Copy it onto every line of the slip.
UPDATE "inventory_transactions" t
SET "overdue_override_reason" = a."after" -> 'overdueOverride' ->> 'reason'
FROM "audit_log_entries" a
WHERE a."action" = 'TOOL_CHECK_OUT'
  AND a."entity_type" = 'ToolLoan'
  AND a."after" -> 'overdueOverride' ->> 'reason' IS NOT NULL
  AND t."type" = 'LOAN'
  AND t."issue_id" = a."entity_id";
