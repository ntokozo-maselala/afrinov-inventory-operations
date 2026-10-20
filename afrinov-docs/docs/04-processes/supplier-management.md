# Process: Supplier Management

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

## Inputs
A new supplier to buy from, or an update to an existing one. The supplier
master follows the vendor list in the AFRI-0000_x purchase order template
("Item Description" workbook).

## Note on AS-IS
The stock workbook has no supplier master — `Supplier Name` is retyped per
transaction (e.g. `Hydroscand` with inconsistent trailing whitespace), so
supplier-level reporting is not possible there. *Unverified* (workbook
observation). The purchase order template's vendor list is the nearest thing
to one, and is what the import reads.

## Steps
1. **Add** on the Suppliers page, or from Receive stock when a delivery
   comes from a new supplier (`POST /api/v1/suppliers`, `create:supplier`:
   PROCUREMENT, STORE_CONTROLLER, ADMIN — ADR-018). Fields: name (required),
   vendor code, contact name, email, phone, address, currency (`ZAR`, `USD`,
   `EUR`, `GBP`; rand by default), payment terms, website, services and
   notes. A `CREATE` audit entry is written.
2. **Edit, deactivate or reactivate** on the supplier's page
   (`PATCH /api/v1/suppliers/:id`, `edit:supplier`). Only the fields that
   change are written, as an `UPDATE` audit entry.
3. **Import the vendor list** (`npm run import:suppliers`, backend). A dry
   run by default: it reads the template's vendor list, compares it with the
   suppliers already in the app and writes a report to `import-reports/`
   without touching the database. With `--apply` (plus the database name
   typed back and the acting user) it creates the new suppliers and fills
   empty fields on existing ones, in one transaction. Nothing already typed
   in the app is overwritten, so it is safe to run again.
4. The supplier is selectable on counter receipts and on purchase orders.
   Its currency sets a new order's default VAT (the VAT setting for rand,
   0% otherwise) and its payment terms fill the order's
   (`purchase-order-lifecycle.md`). A supplier's page lists its orders and
   links to a new order for it.

## Business rules
- Supplier names are unique ignoring case and spacing: checked by the service
  (friendly 409) and enforced by a case-insensitive unique index.
- Vendor codes are unique, letters, digits and dashes only, stored upper case
  without spaces (`v001 ` → `V001`).
- Text is tidied the same way by the API and the import, so both store the
  same spelling: payment terms `COD` / `c.o.d` → `C.O.D`, `30 Days Nett` →
  `30 DAYS NETT`; currency words (`EUROS`, `Rand`) → codes; stray separators
  trimmed from websites.
- Inactive suppliers are refused on receipts and cannot be ordered from;
  the list shows active suppliers first.

## Outputs
Supplier record, available for receipt and PO selection.

## Evidence
- `afrinov-platform/apps/frontend/src/pages/Suppliers.tsx`, `SupplierDetail.tsx`, `components/SupplierForm.tsx`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts` (supplier schemas and routes)
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts` (`SupplierService`)
- `afrinov-platform/apps/backend/src/modules/procurement/supplier-fields.ts`
- `afrinov-platform/apps/backend/scripts/import-suppliers.ts`, `src/modules/migration/vendor-list.ts`
- `afrinov-platform/apps/backend/prisma/migrations/20260101000013_supplier_template_fields/migration.sql`
- `afrinov-platform/apps/backend/src/shared/permissions.ts` (ADR-018)
