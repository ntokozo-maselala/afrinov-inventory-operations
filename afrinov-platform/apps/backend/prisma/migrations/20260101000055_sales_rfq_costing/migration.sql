-- Sales RFQs price one piece of equipment for the client: production labour at
-- each role's selling rate, plus one supplier's quote on each of the project's
-- Procurement RFQs as the material (Procurement recommends one), with the job's
-- markup; the Director approves it and its quotation goes to the client. They
-- never went to suppliers, so the supplier, quote and quotation-file tables go,
-- and so do the typed lines and the buyers' links to them, as the material cost
-- now comes from Procurement's quotes themselves.
--
-- Refused, rather than losing them, where any supplier's price or quotation PDF
-- was recorded against a Sales RFQ: export them first, then delete those rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sales_rfq_quote_prices") OR EXISTS (SELECT 1 FROM "sales_rfq_quote_files") THEN
    RAISE EXCEPTION 'Supplier quotes are recorded on Sales RFQs. Export and delete the rows in sales_rfq_quote_prices and sales_rfq_quote_files before this migration.';
  END IF;
END $$;

-- Status: a Sales RFQ that was "sent" was never priced, so it goes back to a
-- draft for Sales to price and submit.
CREATE TYPE "SalesRfqStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED');
ALTER TABLE "sales_rfqs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "sales_rfqs" ALTER COLUMN "status" TYPE "SalesRfqStatus_new"
  USING (CASE "status"::text WHEN 'SENT' THEN 'DRAFT' ELSE "status"::text END)::"SalesRfqStatus_new";
DROP TYPE "SalesRfqStatus";
ALTER TYPE "SalesRfqStatus_new" RENAME TO "SalesRfqStatus";
ALTER TABLE "sales_rfqs" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Buyers' links to Sales lines, the lines, and the supplier quotes.
ALTER TABLE "rfq_lines" DROP CONSTRAINT "rfq_lines_sales_rfq_line_id_fkey";
DROP INDEX "rfq_lines_sales_rfq_line_id_idx";
ALTER TABLE "rfq_lines" DROP COLUMN "sales_rfq_line_id";

DROP TABLE "sales_rfq_quote_files";
DROP TABLE "sales_rfq_quote_prices";
DROP TABLE "sales_rfq_suppliers";
DROP TABLE "sales_rfq_lines";

-- The quote Procurement recommends Sales costs from. Not an award: no order.
ALTER TABLE "rfqs" ADD COLUMN     "recommended_at" TIMESTAMP(3),
ADD COLUMN     "recommended_by_id" TEXT,
ADD COLUMN     "recommended_supplier_id" TEXT;

-- AlterTable
ALTER TABLE "sales_rfqs" DROP CONSTRAINT "sales_rfqs_sent_by_id_fkey";
ALTER TABLE "sales_rfqs" DROP COLUMN "sent_at",
DROP COLUMN "sent_by_id",
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" TEXT,
ADD COLUMN     "client_address" TEXT,
ADD COLUMN     "client_name" TEXT,
ADD COLUMN     "client_reference" TEXT,
ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "delivery_duration" TEXT,
ADD COLUMN     "delivery_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "delivery_terms" TEXT,
ADD COLUMN     "equipment" TEXT,
ADD COLUMN     "markup_percent" DECIMAL(7,2),
ADD COLUMN     "payment_terms" TEXT,
ADD COLUMN     "quote_reference" TEXT,
ADD COLUMN     "return_reason" TEXT,
ADD COLUMN     "returned_at" TIMESTAMP(3),
ADD COLUMN     "returned_by_id" TEXT,
ADD COLUMN     "signer_email" TEXT,
ADD COLUMN     "signer_phone" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "submitted_by_id" TEXT,
ADD COLUMN     "validity" TEXT,
ADD COLUMN     "vat_rate" DECIMAL(5,2);

-- "Issued" is now the day it was approved, and none have been. The client is
-- the project's, until Sales changes it.
UPDATE "sales_rfqs" SET "issued_at" = NULL;
UPDATE "sales_rfqs" s SET "client_name" = p."client" FROM "projects" p WHERE p."project_number" = s."project_number";

-- CreateTable
CREATE TABLE "sales_rfq_labour_lines" (
    "id" TEXT NOT NULL,
    "sales_rfq_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "labour_rate_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "hours" DECIMAL(10,2) NOT NULL,
    "hourly_rate" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sales_rfq_labour_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rfq_materials" (
    "sales_rfq_id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "quote_total" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_rfq_materials_pkey" PRIMARY KEY ("sales_rfq_id","rfq_id")
);

-- CreateTable
CREATE TABLE "labour_rates" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "hourly_rate" DECIMAL(18,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labour_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_rfq_labour_lines_labour_rate_id_idx" ON "sales_rfq_labour_lines"("labour_rate_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rfq_labour_lines_sales_rfq_id_line_no_key" ON "sales_rfq_labour_lines"("sales_rfq_id", "line_no");

-- CreateIndex
CREATE INDEX "sales_rfq_materials_rfq_id_idx" ON "sales_rfq_materials"("rfq_id");

-- CreateIndex
CREATE UNIQUE INDEX "labour_rates_role_key" ON "labour_rates"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rfqs_quote_reference_key" ON "sales_rfqs"("quote_reference");

-- AddForeignKey
ALTER TABLE "sales_rfqs" ADD CONSTRAINT "sales_rfqs_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfqs" ADD CONSTRAINT "sales_rfqs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfqs" ADD CONSTRAINT "sales_rfqs_returned_by_id_fkey" FOREIGN KEY ("returned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_labour_lines" ADD CONSTRAINT "sales_rfq_labour_lines_sales_rfq_id_fkey" FOREIGN KEY ("sales_rfq_id") REFERENCES "sales_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_labour_lines" ADD CONSTRAINT "sales_rfq_labour_lines_labour_rate_id_fkey" FOREIGN KEY ("labour_rate_id") REFERENCES "labour_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_recommended_supplier_id_fkey" FOREIGN KEY ("recommended_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_recommended_by_id_fkey" FOREIGN KEY ("recommended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_materials" ADD CONSTRAINT "sales_rfq_materials_sales_rfq_id_fkey" FOREIGN KEY ("sales_rfq_id") REFERENCES "sales_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_materials" ADD CONSTRAINT "sales_rfq_materials_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_materials" ADD CONSTRAINT "sales_rfq_materials_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The selling rates as the "Manhours and Material" sheet's Manpower Rate list
-- (A3:B36) has them, rand per hour. The Workshop Manager keeps them up to date.
INSERT INTO "labour_rates" ("id", "role", "hourly_rate", "updated_at")
SELECT gen_random_uuid()::text, r.role, r.rate, CURRENT_TIMESTAMP
FROM (VALUES
  ('Director', 1800), ('Manager', 800), ('Supervisor', 500),
  ('Senior Boiler Maker', 400), ('Boiler Maker', 300), ('Semi-Skilled BM', 200),
  ('Senior Welder', 500), ('Welder', 400), ('Junior Welder', 250),
  ('Senior Rigger', 400), ('Rigger', 300),
  ('Senior Turner and Fitter', 400), ('Machine Operator', 300), ('Junior Machine Operator', 250),
  ('General Assistants', 150), ('Painter', 250), ('Driver', 150), ('Turner', 300),
  ('Accountant', 800), ('Finance Clerk Intern', 150),
  ('Procurement Manager', 800), ('Senior Procurement Officer', 400), ('Procurement Officer', 300),
  ('Cleaner', 150), ('Mechanical Engineer', 600), ('Junior Mechanical Engineer', 400),
  ('Junior Marketing Officer', 250), ('Sales & Marketing Intern', 150),
  ('HR Manager', 800), ('HR Officer', 300), ('Production Manager', 1200),
  ('Admin Assistant', 200), ('Operations Manager', 1400), ('SHEQ Officer', 300)
) AS r("role", "rate")
ON CONFLICT ("role") DO NOTHING;

-- Who may approve a Sales RFQ, and who keeps the rates, as an existing database
-- has them without re-running the seed. Sales no longer deals with suppliers.
INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid()::text, 'approve:sales_rfq', 'approve:sales_rfq'),
  (gen_random_uuid()::text, 'manage:labour_rates', 'manage:labour_rates')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE (r."name"::text = 'ADMIN' AND p."code" IN ('approve:sales_rfq', 'manage:labour_rates'))
   OR (r."name"::text = 'DIRECTOR' AND p."code" = 'approve:sales_rfq')
   OR (r."name"::text = 'WORKSHOP_MANAGER' AND p."code" = 'manage:labour_rates')
ON CONFLICT DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."name"::text = 'SALES' AND p."code" IN ('create:supplier', 'edit:supplier');

-- The wording printed on the quotation to a client, as on the Northam Platinum
-- quotation, for Settings → Purchase orders.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at") VALUES
  ('purchaseOrders.quotationNotes',
   '"Orders to be made out to Afrinov (Pty) Ltd."',
   'string', 'purchase_orders',
   'The Notes printed in bold on every quotation to a client, under the prices. Leave blank to leave them off.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.quotationLetterhead',
   '"Afrinov (Pty) Ltd\nUnit 9 & 11, 546 Constantia Office Park, 16th Road, Randjespark, Midrand, 1685, South Africa\nT +27 11 077 8670 · admin@afrinov.co.za · www.afrinov.co.za\nRegistration no: 2017/009478/07 · VAT Registration No: 4010288142"',
   'string', 'purchase_orders',
   'The company details printed at the foot of every quotation to a client: address, phone, email, website, registration and VAT numbers, one to a line.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
