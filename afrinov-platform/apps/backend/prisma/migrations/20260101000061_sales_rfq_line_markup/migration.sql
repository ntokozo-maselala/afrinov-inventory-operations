-- Each equipment line may carry its own markup, as the costing sheet marks each
-- line up on its own (AFRI-0413: the maintenance × 1.3 × 1.2, the spares
-- × 1.35 × 1.2). Null means the line takes the job's markup
-- (sales_rfqs.markup_percent), so every line kept so far stays null and every
-- price, approved or not, stays exactly as it was.
ALTER TABLE "sales_rfq_equipment_lines" ADD COLUMN "markup_percent" DECIMAL(7,2);
