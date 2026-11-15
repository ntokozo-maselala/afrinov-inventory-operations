-- A quotation's own Notes, printed under the company's (Settings ->
-- purchaseOrders.quotationNotes), one per line, as AFRI-0413 Rev 2 adds
-- "All Flexibles to be free issued by client".
--
-- An equipment line may now have quantity 0: printed with its unit price and
-- "R -", charging nothing. That is a rule of the service, not of the column,
-- which already takes any whole number; nothing else changes here.
ALTER TABLE "sales_rfqs" ADD COLUMN "quote_notes" TEXT;
