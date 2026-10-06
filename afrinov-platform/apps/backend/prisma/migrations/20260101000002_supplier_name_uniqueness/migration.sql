-- Supplier name uniqueness (K9): enforce case-insensitive uniqueness
-- at the database level using citext. The application layer already
-- checks case-insensitively on create (SupplierService.create); this
-- closes the concurrent-creation race where two simultaneous requests
-- both pass the app-layer check and insert case-variant duplicates.
--
-- OPERATOR NOTE: if the database already contains case-insensitive
-- duplicate supplier names, this index creation will fail. Merge the
-- duplicate master-data rows first (repointing purchase_orders and
-- goods_receipts to the surviving row), then re-run `prisma migrate
-- deploy`. The app-layer check remains in place as the friendly-error
-- path and as the fallback for databases where citext cannot be used.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_name_ci_key" ON "suppliers" (citext("name"));
