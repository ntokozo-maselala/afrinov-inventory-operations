-- Prices and VAT on purchase orders, as on the AFRI-0000_x purchase order
-- template: unit price per line, and the order's currency and VAT rate, fixed
-- when the order is raised. Orders raised before this keep no prices; they
-- were all in rand, so they get ZAR and 15%.
ALTER TABLE "purchase_orders" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ZAR';
ALTER TABLE "purchase_orders" ADD COLUMN "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 15;
ALTER TABLE "purchase_order_lines" ADD COLUMN "unit_price" DECIMAL(18,4);

-- The VAT rate for new rand orders, under Settings > Purchase orders.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at")
VALUES ('purchaseOrders.vatRate', '15', 'number', 'purchase_orders',
        'VAT rate, in percent, on new purchase orders to rand suppliers. Orders to suppliers in other currencies start at 0%. Either can be changed on the order.',
        true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
