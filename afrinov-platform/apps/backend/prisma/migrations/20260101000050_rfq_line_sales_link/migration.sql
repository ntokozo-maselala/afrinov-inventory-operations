-- The Sales line a buyer matched each Procurement RFQ line to, for the savings
-- report. Optional, and several lines can share one.
ALTER TABLE "rfq_lines" ADD COLUMN "sales_rfq_line_id" TEXT;

CREATE INDEX "rfq_lines_sales_rfq_line_id_idx" ON "rfq_lines"("sales_rfq_line_id");

ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_sales_rfq_line_id_fkey" FOREIGN KEY ("sales_rfq_line_id") REFERENCES "sales_rfq_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
