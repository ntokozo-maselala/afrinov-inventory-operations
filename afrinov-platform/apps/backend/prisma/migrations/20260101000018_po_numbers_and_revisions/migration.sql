-- Order numbers and revisions as on the AFRI-0000_x template: new orders are
-- numbered AFRI-0001, AFRI-0002, … and carry a revision ("Rev 00") that goes
-- up each time an approved order is changed. Orders numbered before this keep
-- their numbers and start at revision 0.
ALTER TABLE "purchase_orders" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- Where AFRI numbering starts, under Settings > Purchase orders: one past the
-- last number issued from the workbook, so no number is used twice.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at")
VALUES ('purchaseOrders.firstNumber', '1', 'number', 'purchase_orders',
        'The first AFRI number the app issues: set it to one past the last purchase order number issued from the workbook. The app always continues after the highest AFRI number it has issued.',
        true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
