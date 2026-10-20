-- Company details printed on the purchase order document, as on the
-- AFRI-0000_x template's Order sheet: Afrinov's VAT number, where invoices go,
-- and the supplier code of conduct (blank until an admin adds it).
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at") VALUES
  ('purchaseOrders.companyVatNumber', '"4010288142"', 'string', 'purchase_orders',
   'Afrinov''s VAT number, printed on every purchase order.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.invoiceEmail', '"accounts@afrinov.co.za"', 'string', 'purchase_orders',
   'Where suppliers send invoices, printed under the order lines.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.codeOfConduct', '""', 'string', 'purchase_orders',
   'The supplier code of conduct printed on every purchase order. Leave blank to leave it off.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
