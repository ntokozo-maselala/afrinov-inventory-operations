-- A purchase order line's discount to 4 decimal places, as a supplier's
-- discount may need: Hytec's 5/18 off on AFRI-0413_1 is 27.7778%, which 2
-- places (27.78%) put R1,72 off the quote. Every discount kept so far has at
-- most 2 places and keeps its value; 100.0000 still fits.
ALTER TABLE "purchase_order_lines" ALTER COLUMN "discount_percent" TYPE DECIMAL(7,4);
