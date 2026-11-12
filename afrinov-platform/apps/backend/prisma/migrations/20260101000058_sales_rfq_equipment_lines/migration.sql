-- More than one equipment line on a Sales RFQ (AFRI-02A-1094-04-1 quotes the
-- door and its installation as two). Each line is priced as the one line was:
-- its own labour, quotes and, new, other costs (accommodation, LOA), for one
-- unit, with the job's markup, times its quantity.
--
-- Every Sales RFQ becomes one line, quantity 1, named as its equipment was,
-- holding all its labour and quotes. One line of quantity 1 with no other costs
-- adds up exactly as before (sales-costing.ts), so no approved price moves.

-- CreateTable
CREATE TABLE "sales_rfq_equipment_lines" (
    "id" TEXT NOT NULL,
    "sales_rfq_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "equipment" TEXT,
    "details" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_rfq_equipment_lines_pkey" PRIMARY KEY ("id")
);

-- One line for each Sales RFQ, from its equipment.
INSERT INTO "sales_rfq_equipment_lines" ("id", "sales_rfq_id", "line_no", "equipment", "details", "quantity")
SELECT gen_random_uuid()::text, "id", 1, "equipment", NULL, 1
FROM "sales_rfqs";

-- Its labour and quotes go on that line.
ALTER TABLE "sales_rfq_labour_lines" ADD COLUMN     "equipment_line_id" TEXT;
UPDATE "sales_rfq_labour_lines" l
SET "equipment_line_id" = e."id"
FROM "sales_rfq_equipment_lines" e
WHERE e."sales_rfq_id" = l."sales_rfq_id";
ALTER TABLE "sales_rfq_labour_lines" ALTER COLUMN "equipment_line_id" SET NOT NULL;

ALTER TABLE "sales_rfq_materials" ADD COLUMN     "equipment_line_id" TEXT;
UPDATE "sales_rfq_materials" m
SET "equipment_line_id" = e."id"
FROM "sales_rfq_equipment_lines" e
WHERE e."sales_rfq_id" = m."sales_rfq_id";
ALTER TABLE "sales_rfq_materials" ALTER COLUMN "equipment_line_id" SET NOT NULL;

-- The equipment is now the line's.
ALTER TABLE "sales_rfqs" DROP COLUMN "equipment";

-- CreateTable
CREATE TABLE "sales_rfq_other_costs" (
    "id" TEXT NOT NULL,
    "sales_rfq_id" TEXT NOT NULL,
    "equipment_line_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sales_rfq_other_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_rfq_equipment_lines_sales_rfq_id_line_no_key" ON "sales_rfq_equipment_lines"("sales_rfq_id", "line_no");

-- CreateIndex
CREATE INDEX "sales_rfq_other_costs_equipment_line_id_idx" ON "sales_rfq_other_costs"("equipment_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rfq_other_costs_sales_rfq_id_line_no_key" ON "sales_rfq_other_costs"("sales_rfq_id", "line_no");

-- CreateIndex
CREATE INDEX "sales_rfq_labour_lines_equipment_line_id_idx" ON "sales_rfq_labour_lines"("equipment_line_id");

-- CreateIndex
CREATE INDEX "sales_rfq_materials_equipment_line_id_idx" ON "sales_rfq_materials"("equipment_line_id");

-- AddForeignKey
ALTER TABLE "sales_rfq_equipment_lines" ADD CONSTRAINT "sales_rfq_equipment_lines_sales_rfq_id_fkey" FOREIGN KEY ("sales_rfq_id") REFERENCES "sales_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_labour_lines" ADD CONSTRAINT "sales_rfq_labour_lines_equipment_line_id_fkey" FOREIGN KEY ("equipment_line_id") REFERENCES "sales_rfq_equipment_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_materials" ADD CONSTRAINT "sales_rfq_materials_equipment_line_id_fkey" FOREIGN KEY ("equipment_line_id") REFERENCES "sales_rfq_equipment_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_other_costs" ADD CONSTRAINT "sales_rfq_other_costs_sales_rfq_id_fkey" FOREIGN KEY ("sales_rfq_id") REFERENCES "sales_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_other_costs" ADD CONSTRAINT "sales_rfq_other_costs_equipment_line_id_fkey" FOREIGN KEY ("equipment_line_id") REFERENCES "sales_rfq_equipment_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
