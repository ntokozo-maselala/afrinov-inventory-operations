-- The currency each supplier's quote on a request for quotation was given in
-- (RFQ roadmap, Phase 5), so an award never prices an order in a currency it
-- wasn't quoted in. Quotes recorded before this keep none and are taken as
-- given in the supplier's currency. Only adds a column.
-- AlterTable
ALTER TABLE "rfq_suppliers" ADD COLUMN     "currency" TEXT;

