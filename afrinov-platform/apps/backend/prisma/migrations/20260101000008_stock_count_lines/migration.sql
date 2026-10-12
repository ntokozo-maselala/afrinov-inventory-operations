-- Full count sheets: every item on a stock count, with what the system had and
-- what was counted, matched or not. Earlier counts stored only their
-- differences (as COUNT_VARIANCE adjustments), so they have no lines here.
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "expected_quantity" DECIMAL(18,4) NOT NULL,
    "counted_quantity" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_count_lines_count_id_idx" ON "stock_count_lines"("count_id");

ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
