-- The supplier's contact and address on each purchase order, as on the
-- AFRI-0000_x template's Inputs sheet: copied from the supplier when the
-- order is raised and editable on the order, so an order keeps the details
-- it was sent with. Orders raised before this get the supplier's current
-- details, which is what they showed until now.
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_contact_name" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_contact_phone" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_contact_email" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_address" TEXT;

UPDATE "purchase_orders" AS po
SET "supplier_contact_name"  = s."contact_name",
    "supplier_contact_phone" = s."contact_phone",
    "supplier_contact_email" = s."contact_email",
    "supplier_address"       = s."address"
FROM "suppliers" AS s
WHERE s."id" = po."supplier_id";
