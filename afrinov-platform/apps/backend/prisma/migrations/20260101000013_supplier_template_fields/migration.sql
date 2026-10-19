-- The vendor list in the AFRI-0000_x purchase order template keeps a vendor
-- code, address, currency, payment terms, website and what each supplier
-- provides. All optional except currency, which existing suppliers get as ZAR.
ALTER TABLE "suppliers" ADD COLUMN "vendor_code" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "address" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ZAR';
ALTER TABLE "suppliers" ADD COLUMN "payment_terms" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "website" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "services" TEXT;
CREATE UNIQUE INDEX "suppliers_vendor_code_key" ON "suppliers"("vendor_code");
