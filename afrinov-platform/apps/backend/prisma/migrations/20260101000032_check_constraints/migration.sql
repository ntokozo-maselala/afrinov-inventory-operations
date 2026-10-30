-- Database CHECK constraints behind the invariants the services already
-- enforce (PRA-14). The application refuses these values before writing; the
-- constraints make an application defect, a manual SQL change or a future
-- writer that skips the services fail loudly instead of storing bad data.
--
-- Prisma's schema language cannot express CHECK constraints, so they live only
-- here. `prisma migrate diff` ignores them, so they do not trip the drift gate.
--
-- Forward-only. The preflight counts violating rows first and aborts the whole
-- migration with the counts if there are any, so a populated database is never
-- left half-constrained. As with 20260101000027, Prisma then records the
-- migration as failed: repair the named rows (through the application, by
-- reversal or adjustment, never by editing the ledger), clear it with
-- `npx prisma migrate resolve --rolled-back 20260101000032_check_constraints`,
-- and deploy again.
DO $$
DECLARE
  bad_balances integer;
  bad_po_lines integer;
  bad_orders integer;
  bad_receipt_lines integer;
  bad_rfq integer;
  bad_users integer;
BEGIN
  LOCK TABLE "inventory_balances", "purchase_order_lines", "purchase_orders",
    "goods_receipt_lines", "rfq_lines", "rfq_quote_prices", "users"
    IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO bad_balances FROM "inventory_balances" WHERE "quantity" < 0;
  SELECT count(*) INTO bad_po_lines FROM "purchase_order_lines"
    WHERE "ordered_qty" <= 0 OR "received_qty" < 0 OR "unit_price" < 0;
  SELECT count(*) INTO bad_orders FROM "purchase_orders"
    WHERE "vat_rate" < 0 OR "vat_rate" > 100
       OR "settlement_discount" < 0 OR "settlement_discount" > 100;
  SELECT count(*) INTO bad_receipt_lines FROM "goods_receipt_lines" WHERE "quantity" <= 0;
  SELECT (SELECT count(*) FROM "rfq_lines" WHERE "quantity" <= 0)
       + (SELECT count(*) FROM "rfq_quote_prices" WHERE "unit_price" < 0)
    INTO bad_rfq;
  SELECT count(*) INTO bad_users FROM "users"
    WHERE "approval_limit" < 0 OR "failed_login_count" < 0;

  IF bad_balances + bad_po_lines + bad_orders + bad_receipt_lines + bad_rfq + bad_users > 0 THEN
    RAISE EXCEPTION
      'Rows violate the new constraints: % negative balance(s), % purchase order line(s), % purchase order(s), % goods receipt line(s), % RFQ row(s), % user(s). Repair them, run prisma migrate resolve --rolled-back 20260101000032_check_constraints, then deploy again.',
      bad_balances, bad_po_lines, bad_orders, bad_receipt_lines, bad_rfq, bad_users;
  END IF;

  ALTER TABLE "inventory_balances"
    ADD CONSTRAINT "inventory_balances_quantity_non_negative" CHECK ("quantity" >= 0);

  ALTER TABLE "purchase_order_lines"
    ADD CONSTRAINT "purchase_order_lines_ordered_qty_positive" CHECK ("ordered_qty" > 0),
    ADD CONSTRAINT "purchase_order_lines_received_qty_non_negative" CHECK ("received_qty" >= 0),
    ADD CONSTRAINT "purchase_order_lines_unit_price_non_negative" CHECK ("unit_price" IS NULL OR "unit_price" >= 0);

  ALTER TABLE "purchase_orders"
    ADD CONSTRAINT "purchase_orders_vat_rate_range" CHECK ("vat_rate" BETWEEN 0 AND 100),
    ADD CONSTRAINT "purchase_orders_settlement_discount_range" CHECK ("settlement_discount" BETWEEN 0 AND 100);

  ALTER TABLE "goods_receipt_lines"
    ADD CONSTRAINT "goods_receipt_lines_quantity_positive" CHECK ("quantity" > 0);

  ALTER TABLE "rfq_lines"
    ADD CONSTRAINT "rfq_lines_quantity_positive" CHECK ("quantity" > 0);

  ALTER TABLE "rfq_quote_prices"
    ADD CONSTRAINT "rfq_quote_prices_unit_price_non_negative" CHECK ("unit_price" >= 0);

  ALTER TABLE "users"
    ADD CONSTRAINT "users_approval_limit_non_negative" CHECK ("approval_limit" IS NULL OR "approval_limit" >= 0),
    ADD CONSTRAINT "users_failed_login_count_non_negative" CHECK ("failed_login_count" >= 0);
END $$;
