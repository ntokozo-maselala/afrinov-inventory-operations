-- A discount on each purchase order line, off its unit price (the supplier's
-- list price). Discounts count toward Procurement's KPIs, so the saving is kept
-- rather than folded into a net price. Existing lines have none.
ALTER TABLE "purchase_order_lines" ADD COLUMN "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0;
