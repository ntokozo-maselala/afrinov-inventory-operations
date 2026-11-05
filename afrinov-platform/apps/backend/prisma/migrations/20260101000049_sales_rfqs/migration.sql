-- Sales requests for quotation: kept apart from Procurement's RFQs, as buyers and
-- the store must not see what Sales was quoted, and lines are typed, not catalogue items.
-- CreateEnum
CREATE TYPE "SalesRfqStatus" AS ENUM ('DRAFT', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "sales_rfqs" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "SalesRfqStatus" NOT NULL DEFAULT 'DRAFT',
    "project_number" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "penalties_apply" BOOLEAN NOT NULL DEFAULT false,
    "issued_at" DATE,
    "closing_date" DATE,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "sent_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancellation_reason" TEXT,

    CONSTRAINT "sales_rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rfq_lines" (
    "id" TEXT NOT NULL,
    "sales_rfq_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "sales_rfq_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rfq_suppliers" (
    "id" TEXT NOT NULL,
    "sales_rfq_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "quote_reference" TEXT,
    "quoted_at" DATE,
    "valid_until" DATE,
    "lead_time" TEXT,
    "notes" TEXT,
    "currency" TEXT,
    "declined" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_rfq_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rfq_quote_prices" (
    "sales_rfq_supplier_id" TEXT NOT NULL,
    "sales_rfq_line_id" TEXT NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "sales_rfq_quote_prices_pkey" PRIMARY KEY ("sales_rfq_supplier_id","sales_rfq_line_id")
);

-- CreateTable
CREATE TABLE "sales_rfq_quote_files" (
    "sales_rfq_supplier_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_id" TEXT NOT NULL,

    CONSTRAINT "sales_rfq_quote_files_pkey" PRIMARY KEY ("sales_rfq_supplier_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_rfqs_number_key" ON "sales_rfqs"("number");

-- CreateIndex
CREATE INDEX "sales_rfqs_status_idx" ON "sales_rfqs"("status");

-- CreateIndex
CREATE INDEX "sales_rfqs_project_number_idx" ON "sales_rfqs"("project_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rfq_lines_sales_rfq_id_line_no_key" ON "sales_rfq_lines"("sales_rfq_id", "line_no");

-- CreateIndex
CREATE INDEX "sales_rfq_suppliers_supplier_id_idx" ON "sales_rfq_suppliers"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rfq_suppliers_sales_rfq_id_supplier_id_key" ON "sales_rfq_suppliers"("sales_rfq_id", "supplier_id");

-- CreateIndex
CREATE INDEX "sales_rfq_quote_prices_sales_rfq_line_id_idx" ON "sales_rfq_quote_prices"("sales_rfq_line_id");

-- AddForeignKey
ALTER TABLE "sales_rfqs" ADD CONSTRAINT "sales_rfqs_project_number_fkey" FOREIGN KEY ("project_number") REFERENCES "projects"("project_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfqs" ADD CONSTRAINT "sales_rfqs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfqs" ADD CONSTRAINT "sales_rfqs_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfqs" ADD CONSTRAINT "sales_rfqs_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_lines" ADD CONSTRAINT "sales_rfq_lines_sales_rfq_id_fkey" FOREIGN KEY ("sales_rfq_id") REFERENCES "sales_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_lines" ADD CONSTRAINT "sales_rfq_lines_unit_of_measure_fkey" FOREIGN KEY ("unit_of_measure") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_suppliers" ADD CONSTRAINT "sales_rfq_suppliers_sales_rfq_id_fkey" FOREIGN KEY ("sales_rfq_id") REFERENCES "sales_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_suppliers" ADD CONSTRAINT "sales_rfq_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_quote_prices" ADD CONSTRAINT "sales_rfq_quote_prices_sales_rfq_supplier_id_fkey" FOREIGN KEY ("sales_rfq_supplier_id") REFERENCES "sales_rfq_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_quote_prices" ADD CONSTRAINT "sales_rfq_quote_prices_sales_rfq_line_id_fkey" FOREIGN KEY ("sales_rfq_line_id") REFERENCES "sales_rfq_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_quote_files" ADD CONSTRAINT "sales_rfq_quote_files_sales_rfq_supplier_id_fkey" FOREIGN KEY ("sales_rfq_supplier_id") REFERENCES "sales_rfq_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_quote_files" ADD CONSTRAINT "sales_rfq_quote_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The Sales role and who may see Sales prices, as an existing database has them
-- without re-running the seed.
INSERT INTO "roles" ("id", "name", "description")
SELECT gen_random_uuid()::text, 'SALES'::"RoleName", 'SALES role'
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."name"::text = 'SALES');

INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid()::text, 'view:sales_rfq', 'view:sales_rfq'),
  (gen_random_uuid()::text, 'manage:sales_rfq', 'manage:sales_rfq')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE (r."name"::text IN ('ADMIN', 'SALES') AND p."code" IN ('view:sales_rfq', 'manage:sales_rfq'))
   OR (r."name"::text IN ('PROCUREMENT_MANAGER', 'DIRECTOR', 'CEO') AND p."code" = 'view:sales_rfq')
   OR (r."name"::text = 'SALES' AND p."code" IN ('manage:projects', 'create:supplier', 'edit:supplier', 'view:reports'))
ON CONFLICT DO NOTHING;
