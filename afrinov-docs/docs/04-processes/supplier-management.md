# Process: Supplier Management

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Inputs
A new supplier to buy from, or an update to an existing one.

## Note on AS-IS
No supplier master exists — `Supplier Name` is retyped per transaction
(e.g. `Hydroscand` with inconsistent trailing whitespace), so
supplier-level reporting is not possible today. *Unverified* (workbook
observation). The import does not read supplier names from the workbook;
the buyer types them into `master-data.xlsx`
(`07-data/migration-strategy.md`).

## Steps
1. Suppliers page: create a supplier — name (required), contact name,
   email, phone, notes (`POST /api/v1/suppliers`, `create:supplier`:
   PROCUREMENT, ADMIN). A `CREATE` audit entry is written.
2. The supplier is selectable on counter receipts and, when procurement is
   on, on purchase orders and goods receipts. Inactive suppliers are
   refused on receipts.
3. Update / deactivate: **Planned** — no endpoint exists, although the
   `edit:supplier` permission and the `active` column do (TD-013).

## Business rules
- Supplier names are unique ignoring case: checked by the service (friendly
  409) and enforced by a case-insensitive unique index. Surrounding spaces
  are trimmed on create.

## Outputs
Supplier record, available for receipt and PO selection.

## Evidence
- `afrinov-platform/apps/frontend/src/pages/Suppliers.tsx`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts:10-16,78-95`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts:33-70`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000002_supplier_name_uniqueness/migration.sql:16`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-receipt.service.ts:49-51`
