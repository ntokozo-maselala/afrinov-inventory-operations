-- A note on a counted item, mostly to say why it differs from the system
-- ("3 cracked, binned"). It is also added to that item's adjustment note.
ALTER TABLE "stock_count_lines" ADD COLUMN "note" TEXT;
