-- Stock accuracy and corrections (ADR-040, system audit P4).

-- B2: a tool checked in damaged is held for repair until repaired or written off.
CREATE TABLE "tool_repairs" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "return_id" TEXT,
    "note" TEXT,
    "reported_by_id" TEXT NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "transaction_id" TEXT,

    CONSTRAINT "tool_repairs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tool_repairs_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "tool_repairs_resolution_check" CHECK (
      ("resolved_at" IS NULL AND "resolution" IS NULL) OR ("resolved_at" IS NOT NULL AND "resolution" IN ('REPAIRED', 'WRITTEN_OFF'))
    )
);
CREATE INDEX "tool_repairs_material_id_location_id_resolved_at_idx" ON "tool_repairs"("material_id", "location_id", "resolved_at");
ALTER TABLE "tool_repairs" ADD CONSTRAINT "tool_repairs_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tool_repairs" ADD CONSTRAINT "tool_repairs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tool_repairs" ADD CONSTRAINT "tool_repairs_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tool_repairs" ADD CONSTRAINT "tool_repairs_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- C4: blind counts, off until the store switches them on.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at") VALUES
  ('inventory.blindCounts', 'false', 'boolean', 'inventory',
   'When on, the count sheet shows no system quantities: the counter types what is on the shelf without seeing the book figure. A line whose stock moves after the sheet is opened is held back for a recount.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- A8: how far a delivery may go over the order, with a reason kept on the line.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at") VALUES
  ('purchaseOrders.overDeliveryPercent', '0', 'number', 'purchase_orders',
   'How far a delivery may go over the quantity ordered on a line, as a percentage of it: at 5, 105 of 100 can be received, with a reason. 0: never more than was ordered.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
ALTER TABLE "goods_receipt_lines" ADD COLUMN "over_delivery_reason" TEXT;

-- A6, A7: each posted receipt line knows its movement, so one line can be
-- reversed or sent back on its own.
ALTER TABLE "goods_receipt_lines" ADD COLUMN "transaction_id" TEXT;

-- A6: goods sent back to the supplier.
ALTER TYPE "InventoryTransactionType" ADD VALUE 'RETURN_TO_SUPPLIER';
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "goods_receipt_line_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "supplier_reference" TEXT,
    "transaction_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_returns_quantity_check" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "supplier_returns_transaction_id_key" ON "supplier_returns"("transaction_id");
CREATE INDEX "supplier_returns_goods_receipt_line_id_idx" ON "supplier_returns"("goods_receipt_line_id");
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
