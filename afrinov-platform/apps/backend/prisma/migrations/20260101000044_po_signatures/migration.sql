-- Purchase orders are signed by role and value (po-approval.ts): the Procurement
-- Manager, then the Director from the threshold up, with stand-ins.
CREATE TYPE "ApprovalStep" AS ENUM ('MANAGER', 'DIRECTOR');

CREATE TABLE "purchase_order_signatures" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "step" "ApprovalStep" NOT NULL,
    "signed_by_id" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stand_in" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "purchase_order_signatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_signatures_purchase_order_id_step_key" ON "purchase_order_signatures"("purchase_order_id", "step");
CREATE INDEX "purchase_order_signatures_signed_by_id_idx" ON "purchase_order_signatures"("signed_by_id");

ALTER TABLE "purchase_order_signatures" ADD CONSTRAINT "purchase_order_signatures_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_signatures" ADD CONSTRAINT "purchase_order_signatures_signed_by_id_fkey" FOREIGN KEY ("signed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rand per unit of the order's currency, locked at submission.
ALTER TABLE "purchase_orders" ADD COLUMN "exchange_rate" DECIMAL(18,6);

-- Orders approved before this keep their one approver as a signature, so an
-- edit is checked against what was actually signed.
INSERT INTO "purchase_order_signatures" ("id", "purchase_order_id", "step", "signed_by_id", "signed_at")
SELECT gen_random_uuid()::text, "id", 'MANAGER', "approved_by_id", COALESCE("approved_at", CURRENT_TIMESTAMP)
FROM "purchase_orders"
WHERE "approved_by_id" IS NOT NULL;

-- The new roles and permission, here so existing databases get them without
-- re-running the seed.
INSERT INTO "roles" ("id", "name", "description")
SELECT gen_random_uuid()::text, v.name::"RoleName", v.name || ' role'
FROM (VALUES ('PROCUREMENT_MANAGER'), ('DIRECTOR'), ('CEO'), ('WORKSHOP_MANAGER')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."name"::text = v.name);

INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'approve:stores_order', 'approve:stores_order')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE (r."name"::text IN ('PROCUREMENT_MANAGER', 'DIRECTOR', 'CEO', 'WORKSHOP_MANAGER') AND p."code" IN ('approve:purchase_order', 'view:purchase_order', 'view:reports'))
   OR (r."name"::text IN ('PROCUREMENT_MANAGER', 'WORKSHOP_MANAGER', 'ADMIN') AND p."code" = 'approve:stores_order')
ON CONFLICT DO NOTHING;

-- Approvers no longer sign; the role still sees the orders.
DELETE FROM "role_permissions"
WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "name" = 'APPROVER')
  AND "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" = 'approve:purchase_order');

-- The Director's threshold and exchange rates, at the defaults, as other
-- settings were added. A rate of 0 is not set.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "enum_options", "updated_at")
VALUES
  ('purchaseOrders.directorApprovalFrom', '200000', 'number', 'purchase_orders',
   'From this value, in rand excluding VAT, a project order needs the Director as well as the Procurement Manager.',
   true, NULL, CURRENT_TIMESTAMP),
  ('purchaseOrders.exchangeRateUSD', '0', 'number', 'purchase_orders',
   'Rand per US dollar, to work out who signs an order in USD. An order keeps the rate it was submitted with.',
   true, NULL, CURRENT_TIMESTAMP),
  ('purchaseOrders.exchangeRateEUR', '0', 'number', 'purchase_orders',
   'Rand per euro, to work out who signs an order in EUR. An order keeps the rate it was submitted with.',
   true, NULL, CURRENT_TIMESTAMP),
  ('purchaseOrders.exchangeRateGBP', '0', 'number', 'purchase_orders',
   'Rand per pound, to work out who signs an order in GBP. An order keeps the rate it was submitted with.',
   true, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
