# Migration Strategy

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Two kinds of migration exist: **schema migrations** (how the database
structure changes) and the **workbook import** (how the stock workbook's
data enters the platform once, at go-live).

## Schema migrations
Prisma SQL migrations in `afrinov-platform/apps/backend/prisma/migrations/`,
applied in name order by `npx prisma migrate deploy` (wrapped by
`npm run db:migrate`, and run automatically when the backend container
starts and in the CI integration job).

| Migration | What it does |
|---|---|
| `20260101000000_initial` | Creates every table, enum and index of the original schema |
| `20260101000001_location_management` | Adds location master-data columns (code, address, contacts, notes, audit ids), partial unique index on `code`, indexes on type/active; backfills codes for three seed locations. Idempotent (`IF NOT EXISTS`) |
| `20260101000002_supplier_name_uniqueness` | Enables `citext`; unique index on `citext(name)` for suppliers. Fails if case-variant duplicates already exist |
| `20260101000003_transaction_reversals` | Adds `inventory_transactions.reverses_id`, unique, FK to the reversed row |
| `20260101000004_simplify_purchase_order_statuses` | Replaces the 12-value PO status enum with 7 values, mapping old values (SUBMITTED→PENDING_APPROVAL, SENT/SHIPPED→APPROVED, DELIVERED/FULLY_RECEIVED→RECEIVED, REJECTED→CANCELLED with reason "Rejected"); adds `closed_at/closed_by_id/close_reason` |
| `20260101000005_recipients` | Creates `recipients` (case-insensitive unique name), converts any user ids already in `inventory_transactions.recipient_id` into WORKER recipients, nulls the rest, adds the FK |
| `20260101000006_inventory_returns` | Adds `RETURN` to `InventoryTransactionType` |

Known gaps: the `inventory_balances` foreign keys declared in
`schema.prisma` are not created by any migration (TD-005), and the
`20260101000000_initial/README.md` names a folder that does not exist
(TD-016). There are no down/rollback migrations.

## Workbook import
**Source:** the stock workbook (`AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm`,
kept out of git). The importer reads the four **Main** sheets (one row per
item and location: Brought Forward, IN, OUT, Current Stock, Required Stock)
and the matching **Summary** sheets (unit price) for four categories:
Consumables, Fasteners/Slugs/Insulation, Tooling/PPE/Electrical and
Project Material. It also reads the `Project No.` and `Employees` lists.
Tools are not imported. *Unverified:* whether this workbook is the same
dataset as `07__July_2026_Report.xlsm` described in
`02-business-analysis/current-state-as-is.md`.

**Tool:** `npm run import:workbook` in `apps/backend`
(`scripts/import-workbook.ts`, logic in `src/modules/migration/`). Output
files go to `import-reports/` (git-ignored: they contain business data).

### Steps
1. **Dry run** (default; never touches the database):
   `npm run import:workbook -- --file <workbook.xlsm>`. Reads and checks
   every row and writes `workbook-dry-run-<timestamp>.md` listing what
   would be loaded and every problem, each marked BLOCKING or review.
2. **Review files.** The first dry run also writes:
   - `mapping.xlsx` — a suggested SKU (prefix CON/FSI/TPE/PRJ) and unit for
     each workbook row, and the platform location for each location
     spelling. Rows are matched by category, old Product ID, item name and
     location as written, not by row number. It is never overwritten.
   - `master-data.xlsx` — projects and recipients from the workbook lists;
     suppliers are typed in by the buyer (the workbook has none).
   The storeman and buyer correct these; later dry runs read them back and
   re-check.
3. **Apply** (once per database):
   `npm run import:workbook -- --file <workbook> --apply --database <name> --date <YYYY-MM-DD> --actor <email>`.
   Refuses unless: there are no blocking problems; `--database` matches the
   database in `DATABASE_URL`; the date is not in the future; the actor is
   an active user; no opening balances were imported before; no planned SKU
   already exists. In one database transaction it creates projects,
   recipients and suppliers (skipping existing ones), locations (reusing
   existing ones), items, and one RECEIPT per item and location with
   `reference_type = 'OpeningBalance'`, dated `--date`, and writes an
   `IMPORT_OPENING_BALANCES` audit entry.
4. **Reconcile** (read-only):
   `npm run import:workbook -- --file <workbook> --reconcile`. Compares, per
   category, item count, units and rand value of the posted opening
   balances with the plan built from the workbook, lists every item that
   differs, and writes `reconciliation-<timestamp>.md`.

Location cleansing follows ADR-003: each spelling is mapped to one platform
location in `mapping.xlsx` by a person; nothing is merged automatically.

### Not yet decided (Unverified)
Cut-over date, who signs off the reconciliation, whether the workbook is
frozen after go-live, and whether history before the opening date is ever
imported. See `workbook-replacement-roadmap.md` at the repository root and
`00-governance/assumptions-register.md`.

## Evidence
- `afrinov-platform/apps/backend/prisma/migrations/*/migration.sql`
- `afrinov-platform/apps/backend/src/db/migrate.ts:6`
- `afrinov-platform/apps/backend/docker-compose.yml` — `command:` runs `prisma migrate deploy`
- `afrinov-platform/apps/backend/scripts/import-workbook.ts:1-18,95-189`
- `afrinov-platform/apps/backend/src/modules/migration/workbook-reader.ts:1-7,21-26`
- `afrinov-platform/apps/backend/src/modules/migration/mapping.ts:1-8`
- `afrinov-platform/apps/backend/src/modules/migration/master-data.ts:1-7`
- `afrinov-platform/apps/backend/src/modules/migration/opening-balance.service.ts:1-9,55-80`
- `afrinov-platform/apps/backend/src/modules/migration/reconciliation.ts:1-8`
- `.gitignore` — `*.xlsm`, `import-reports/`
