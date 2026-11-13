-- Material allowances: what Sales estimates for material on an equipment line
-- before any supplier has quoted, as AFRI-0413 quoted "Anticipated Spares:
-- Filters, Pipe Clamps, Fittings" at an allowance and Procurement asked Hytec
-- only after the client's order. Counted as material, for one unit of the line,
-- before markup; kept apart from quotes so what was allowed can later be set
-- against what was ordered. Nothing existing changes.

-- CreateTable
CREATE TABLE "sales_rfq_material_allowances" (
    "id" TEXT NOT NULL,
    "sales_rfq_id" TEXT NOT NULL,
    "equipment_line_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sales_rfq_material_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_rfq_material_allowances_equipment_line_id_idx" ON "sales_rfq_material_allowances"("equipment_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rfq_material_allowances_sales_rfq_id_line_no_key" ON "sales_rfq_material_allowances"("sales_rfq_id", "line_no");

-- AddForeignKey
ALTER TABLE "sales_rfq_material_allowances" ADD CONSTRAINT "sales_rfq_material_allowances_sales_rfq_id_fkey" FOREIGN KEY ("sales_rfq_id") REFERENCES "sales_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rfq_material_allowances" ADD CONSTRAINT "sales_rfq_material_allowances_equipment_line_id_fkey" FOREIGN KEY ("equipment_line_id") REFERENCES "sales_rfq_equipment_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
