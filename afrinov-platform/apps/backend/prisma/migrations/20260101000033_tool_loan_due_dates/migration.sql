-- Tool loans get a due date. It is agreed at check-out and kept on the LOAN
-- row, which is never updated. A later date is an extension with a reason,
-- recorded in its own table that rows are only ever added to.
-- Loans from before this have no due date and fall due
-- inventory.toolOverdueDays after they went out, so nothing flagged today
-- changes.

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "due_on" DATE;

-- CreateTable
CREATE TABLE "tool_loan_extensions" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_loan_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tool_loan_extensions_loan_id_idx" ON "tool_loan_extensions"("loan_id");

-- AddForeignKey
ALTER TABLE "tool_loan_extensions" ADD CONSTRAINT "tool_loan_extensions_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_loan_extensions" ADD CONSTRAINT "tool_loan_extensions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The overdue days setting becomes the default loan period. Its key stays so
-- a value already set is kept.
UPDATE "settings"
SET "description" = 'Default tool loan period, in days: a tool checked out is due back this many days later unless another due date is set at check-out. Older loans with no due date fall due this many days after they went out.'
WHERE "key" = 'inventory.toolOverdueDays';

-- The new loan rules, under Settings > Inventory. Added here so they show on
-- the Settings page without running the seed again.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "enum_options", "updated_at")
VALUES
  ('inventory.toolMaxLoanDays', '30', 'number', 'inventory',
   'The longest a tool may be lent for, in days from check-out, extensions included. Only an administrator can set a later due date.',
   true, NULL, CURRENT_TIMESTAMP),
  ('inventory.toolEscalateDays', '14', 'number', 'inventory',
   'A tool this many days past its due date needs a decision: check it in, extend the loan or write it off as lost. Flagged on the Tools page and the Dashboard.',
   true, NULL, CURRENT_TIMESTAMP),
  ('inventory.toolOverdueCheckout', '"warn"', 'enum', 'inventory',
   'Lending more tools to someone who has an overdue tool. Warn: the tools can still be lent, with a reason. Block: the overdue tools must be checked in or extended first.',
   true, '["warn", "block-contractors", "block"]', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Extending a loan is the store's decision: the store controller and Admin.
INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'extend:tool_loan', 'extend:tool_loan')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."name" IN ('STORE_CONTROLLER', 'ADMIN') AND p."code" = 'extend:tool_loan'
ON CONFLICT DO NOTHING;
