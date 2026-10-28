-- The small print on each purchase order (terms, late delivery penalty,
-- documentation, invoicing & payment, invoice email, code of conduct), copied
-- from the purchase order settings when the order is approved, so a later
-- change to the settings does not change what the supplier accepted. Orders
-- approved before this keep printing the current settings, as they did.
ALTER TABLE "purchase_orders" ADD COLUMN "printed_terms" JSONB;
