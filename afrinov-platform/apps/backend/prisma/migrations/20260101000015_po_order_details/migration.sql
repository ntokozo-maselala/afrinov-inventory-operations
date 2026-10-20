-- The order details on the AFRI-0000_x template's Inputs sheet: project,
-- payment and shipping terms, settlement discount, penalties, where the goods
-- go and who the supplier deals with, and a delivery date per line. All
-- optional or defaulted, so existing orders stay valid.
ALTER TABLE "purchase_orders" ADD COLUMN "project_number" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "payment_terms" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "payment_milestone" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "settlement_discount" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN "shipping_terms" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "penalties_apply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_orders" ADD COLUMN "delivery_method" TEXT NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "purchase_orders" ADD COLUMN "delivery_to" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "delivery_address" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "delivery_country" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "delivery_contact_name" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "delivery_contact_phone" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "afrinov_contact" TEXT;
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_project_number_fkey" FOREIGN KEY ("project_number")
  REFERENCES "projects"("project_number") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "purchase_orders_project_number_idx" ON "purchase_orders"("project_number");

ALTER TABLE "purchase_order_lines" ADD COLUMN "delivery_date" DATE;

-- Where goods are delivered unless the order says otherwise, under
-- Settings > Purchase orders. The site contact starts blank: staff names and
-- numbers are business data and stay out of the repository.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at") VALUES
  ('purchaseOrders.deliveryTo', '"Afrinov (PTY) Ltd"', 'string', 'purchase_orders',
   'Who goods are delivered to, on new purchase orders.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.deliveryAddress', '"10 Lime Street, Icon Industrial Park\nSunderland Ridge, Centurion 0157"', 'string', 'purchase_orders',
   'Delivery address on new purchase orders. One line per address line.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.deliveryCountry', '"South Africa"', 'string', 'purchase_orders',
   'Delivery country on new purchase orders.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.deliveryContactName', '""', 'string', 'purchase_orders',
   'Who receives deliveries at the delivery address, on new purchase orders.', true, CURRENT_TIMESTAMP),
  ('purchaseOrders.deliveryContactPhone', '""', 'string', 'purchase_orders',
   'Phone number for that person.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
