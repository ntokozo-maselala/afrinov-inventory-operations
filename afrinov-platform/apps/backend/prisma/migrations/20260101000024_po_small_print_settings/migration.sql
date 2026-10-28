-- The small print under Remarks on the purchase order document, as on the
-- issued orders: TERMS (with the late delivery penalty, printed only where
-- penalties apply), DOCUMENTATION and INVOICING & PAYMENT, with the wording
-- Afrinov's orders carry. An order keeps the wording it was approved with.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at") VALUES
  ('purchaseOrders.terms',
   '"The Supplier shall deliver all Goods and/or Services by the Purchase Order delivery date and notify the Purchaser in writing within 24 hours of any actual or anticipated delay."',
   'string', 'purchase_orders',
   'TERMS printed on every purchase order. Each order keeps the wording it was approved with. Leave blank to leave it off.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.latePenalty',
   '"Late delivery will incur a penalty of 2% of the contract price per week (or part thereof), up to a maximum of 10%."',
   'string', 'purchase_orders',
   'The late delivery penalty, printed in bold at the end of TERMS, only on orders where penalties apply.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.documentation',
   '"Provide Material Certificates and Material Data Sheets where applicable."',
   'string', 'purchase_orders',
   'DOCUMENTATION the supplier must provide, printed on every purchase order. Leave blank to leave it off.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.invoicing',
   '"The Purchaser may withhold payment for late delivery, missing documentation, or defective/non-conforming Goods or Services."',
   'string', 'purchase_orders',
   'INVOICING & PAYMENT printed on every purchase order, followed by where invoices are submitted. Leave blank to leave it off.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Where invoices go now ends the INVOICING & PAYMENT section.
UPDATE "settings"
SET "description" = 'Where suppliers submit invoices, printed at the end of INVOICING & PAYMENT.'
WHERE "key" = 'purchaseOrders.invoiceEmail';
