-- What the request for quotation document prints for suppliers (RFQ roadmap,
-- Phase 3): the RFQ sheet's Instructions, and where quotations are returned.
-- The return address starts blank, so it is left off until an admin sets it.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at") VALUES
  ('purchaseOrders.rfqInstructions',
   '"Fill in the UNIT PRICE and SUBTOTAL for each line as per the headings below, and save as PDF. All files to be returned as PDF, quoting the RFQ number."',
   'string', 'purchase_orders',
   'Instructions printed on every request for quotation, telling suppliers how to quote. Leave blank to leave them off.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.rfqQuoteEmail',
   '""',
   'string', 'purchase_orders',
   'Where suppliers return their quotations, printed under the instructions on every request for quotation. Leave blank to leave it off.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
