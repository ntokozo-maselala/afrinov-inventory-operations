-- Recipients: the people and places stock is issued to (workers, machines,
-- client sites, contractors). inventory_transactions.recipient_id, which
-- previously held a user id with no foreign key, now points here.

CREATE TYPE "RecipientType" AS ENUM ('WORKER', 'MACHINE', 'SITE', 'CONTRACTOR');

CREATE TABLE "recipients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RecipientType" NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recipients_type_idx" ON "recipients"("type");
CREATE INDEX "recipients_active_idx" ON "recipients"("active");

-- One recipient per name, ignoring case and surrounding spaces, so the list
-- does not repeat "Simngawe" the way the workbook's Employees sheet did.
CREATE UNIQUE INDEX "recipients_name_ci_key" ON "recipients" (lower(btrim("name")));

-- Keep any recipient already recorded: a transaction whose recipient_id is a
-- user becomes a WORKER recipient with that user's id and name.
INSERT INTO "recipients" ("id", "name", "type", "updated_at")
SELECT DISTINCT ON (lower(btrim(u."name"))) u."id", btrim(u."name"), 'WORKER', CURRENT_TIMESTAMP
FROM "users" u
WHERE u."id" IN (SELECT "recipient_id" FROM "inventory_transactions" WHERE "recipient_id" IS NOT NULL)
ORDER BY lower(btrim(u."name")), u."id";

UPDATE "inventory_transactions"
SET "recipient_id" = NULL
WHERE "recipient_id" IS NOT NULL
  AND "recipient_id" NOT IN (SELECT "id" FROM "recipients");

CREATE INDEX "inventory_transactions_recipient_id_idx" ON "inventory_transactions"("recipient_id");

ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
