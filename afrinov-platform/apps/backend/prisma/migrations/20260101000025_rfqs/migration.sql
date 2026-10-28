-- Requests for quotation (RFQ roadmap, Phase 1), as the RFQ sheet of the
-- Manhours and Material workbook: an RFQ, its lines, the suppliers asked to
-- quote, and one unit price per supplier per line. Only adds tables.
-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'SENT', 'AWARDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "rfqs" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "project_number" TEXT,
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
    "awarded_at" TIMESTAMP(3),
    "awarded_by_id" TEXT,
    "purchase_order_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancellation_reason" TEXT,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_lines" (
    "id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "rfq_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_suppliers" (
    "id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "quote_reference" TEXT,
    "quoted_at" DATE,
    "valid_until" DATE,
    "lead_time" TEXT,
    "notes" TEXT,
    "declined" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_quote_prices" (
    "rfq_supplier_id" TEXT NOT NULL,
    "rfq_line_id" TEXT NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "rfq_quote_prices_pkey" PRIMARY KEY ("rfq_supplier_id","rfq_line_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_number_key" ON "rfqs"("number");

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_purchase_order_id_key" ON "rfqs"("purchase_order_id");

-- CreateIndex
CREATE INDEX "rfqs_status_idx" ON "rfqs"("status");

-- CreateIndex
CREATE INDEX "rfqs_project_number_idx" ON "rfqs"("project_number");

-- CreateIndex
CREATE INDEX "rfq_lines_material_id_idx" ON "rfq_lines"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_lines_rfq_id_line_no_key" ON "rfq_lines"("rfq_id", "line_no");

-- CreateIndex
CREATE INDEX "rfq_suppliers_supplier_id_idx" ON "rfq_suppliers"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_suppliers_rfq_id_supplier_id_key" ON "rfq_suppliers"("rfq_id", "supplier_id");

-- CreateIndex
CREATE INDEX "rfq_quote_prices_rfq_line_id_idx" ON "rfq_quote_prices"("rfq_line_id");

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_project_number_fkey" FOREIGN KEY ("project_number") REFERENCES "projects"("project_number") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awarded_by_id_fkey" FOREIGN KEY ("awarded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_quote_prices" ADD CONSTRAINT "rfq_quote_prices_rfq_supplier_id_fkey" FOREIGN KEY ("rfq_supplier_id") REFERENCES "rfq_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_quote_prices" ADD CONSTRAINT "rfq_quote_prices_rfq_line_id_fkey" FOREIGN KEY ("rfq_line_id") REFERENCES "rfq_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

