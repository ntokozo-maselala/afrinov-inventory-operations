# Persistence and database lifecycle

## Database and client lifecycle

The backend uses PostgreSQL 16 and Prisma 5. `prisma/schema.prisma` declares
the PostgreSQL datasource through `env("DATABASE_URL")`. The shared runtime
client in `src/shared/db.ts` is a singleton. It logs warnings/errors in
development and errors elsewhere; outside production it is stored on
`globalThis` to avoid duplicate clients during `tsx watch` reloads.

Client construction is import-time, but connection is lazy. `server.start()`
runs `SELECT 1` as a best-effort startup probe, and `/health/ready` runs the
same query on demand. A missing/unreachable database does not stop the HTTP
listener; database-dependent request paths can fail while liveness remains
200. Pool sizing, connection timeout, TLS, and pooling-proxy settings are not
configured in code; they may be carried in the supplied URL or external
deployment platform and were not verified.

## Data model

There are 20 Prisma models. The central groups are:

| Group | Models / purpose |
| --- | --- |
| Identity and access | `User`, `UserRole`, `Role`, `Permission`, `RolePermission`; bcrypt password hashes and relational role permissions |
| Inventory master data | `Material`, `Location`, `Rack`; unique SKU/name/code/serial constraints, active flags, and location hierarchy |
| Operations | `Project`, `Recipient`; project and issue-recipient references |
| Procurement | `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`, `GoodsReceiptLine` |
| Stock control | `InventoryTransaction`, `InventoryBalance`, `StockCountLine`; signed decimal movement ledger, derived balance read model, count detail |
| Application administration | `Setting`, `AuditLogEntry`; typed JSON settings and change/activity records |

The schema also defines enums for roles, material/location categories,
recipient types, purchase-order/goods-receipt states, transaction types,
adjustment reasons, and setting types/categories. Foreign keys link actors,
materials, locations, projects, recipients, suppliers, orders, and receipts.
Unique constraints and indexes cover business identifiers, common filters,
movement history, and relationship keys. See
[`schema.prisma`](../../../afrinov-platform/apps/backend/prisma/schema.prisma)
for exact fields and constraints.

## Inventory ledger and derived balances

`InventoryTransaction.quantity` is a signed `Decimal(18,4)`: receipts and
transfer-in rows are positive; issues and transfer-out rows are negative;
adjustments may have either sign. Transfer rows are paired. Reversals create
compensating rows and use a unique `reversesId`, so the API can prevent a
movement from being reversed twice. Issue rows can share an issue/slip ID.

`InventoryBalance` is keyed by `(materialId, locationId)` and is recomputed by
aggregating matching ledger quantities. Mutation services read the current
balance, enforce active entities and business rules, write ledger rows, then
upsert recomputed balances within Prisma transaction callbacks. This is a
regular PostgreSQL table maintained by application code, not a PostgreSQL
materialized view or trigger.

The no-negative-stock rule is application-level. No `CHECK` constraint or
trigger was found in the migration SQL to independently reject a negative
ledger/balance state. The inventory service uses transactions but does not
specify a higher isolation level or lock the balance row before its check;
concurrent withdrawals against one balance therefore merit a dedicated
concurrency test before high-volume use. This is a potential race, not a
reproduced data-integrity failure.

The API has no route that edits or deletes a ledger row; mistakes are reversed
through compensating transactions. The database schema itself does not make
the table append-only through triggers or restricted credentials. Direct SQL
or another writer using the DB credentials can bypass the application rule.

## Transactions, validation, and errors

Multi-row stock mutations (`issue`, `transfer`, `adjust`, receipt posting,
returns, stock counts and reversals) use Prisma `$transaction` callbacks. The
API validates shapes with Zod and performs domain checks in service code.
PostgreSQL separately enforces declared types, foreign keys, primary/unique
keys, and indexes. It does not encode every business rule (for example,
active-only locations, permitted transaction sign by type, stock non-negativity,
or workflow transitions) as a database constraint.

Prisma known errors are translated in specific services when necessary;
otherwise errors propagate to `server.ts`, where `ApiError` is mapped to its
HTTP status and unexpected errors become generic 500 responses. Connection
failure, timeout, and constraint handling is not uniformly specialized in
every module.

## Migrations and schema changes

There are 22 committed migration directories numbered
`20260101000000_initial` through `20260101000021_location_parent`. The lock
file provider is PostgreSQL. `npm run db:migrate` invokes
`src/db/migrate.ts`, which runs `npx prisma migrate deploy` against the
current `DATABASE_URL`. `docker-compose.yml` also applies `prisma migrate deploy`
on container startup. No automatic rollback or down-migration procedure is
provided. The static migration tests inspect SQL text; the CI integration job
applies the migrations to its disposable PostgreSQL 16 service.

Before applying migrations manually:

1. Set `DATABASE_URL` explicitly for the intended non-production database.
2. Confirm its database name/host with a safe, read-only database-client
   inspection; do not echo the connection URL because it may contain a secret.
3. Take/confirm a recoverable backup before schema changes where data matters.
4. Run `npm run db:migrate` only after the target has been verified.
5. Check `/health/ready` and application behavior after applying.

This audit did not run migrations against any database.

## Seed and imports

`src/db/seed.ts` upserts permissions, roles, a bootstrap admin, and demo master
data. On a fresh database it creates demo suppliers, locations, materials,
projects, recipients, sample orders/receipts and inventory transactions. It
does not replace an existing admin password; a separate rotation script does
that. In production, seeding currently checks for a nonblank
`SEED_ADMIN_PASSWORD` **before** looking up whether the admin already exists.
It therefore requires the value on every production seed invocation, despite
Compose comments describing it as needed only on first creation. The Compose
command always runs the seed after migrations, so a fresh Compose database is
demo-populated and later restarts also need the password variable present.

Workbook/supplier imports and rack conversion scripts write to the database
selected by `DATABASE_URL`; inspect script help and target guards before
running. These operations were not run in this audit.

## Development/test isolation

- `.env.example` points to a local database name; `.env.test.example` points to
  a distinct test name.
- Unit tests set a dummy URL if none exists and mock DB-backed services; they
  do not require a real database.
- `vitest.integration.config.ts` reads `.env.test` only, forces test mode, and
  requires a local PostgreSQL host plus a database name ending in `_test`.
  Guarded migration/seed scripts apply the same check before writes. The
  integration helper persists rows in that isolated database.
- CI creates a disposable Postgres service, migrates/seeds it, and runs the
  real-HTTP suite there.

The separate Compose `test-db` profile uses loopback port 5433 and its own
named volume. It requires the dedicated `POSTGRES_TEST_PASSWORD`. CI provisions
an ephemeral Postgres service. No local developer or production database is
an allowed test target. The real DB test cycle has not yet been exercised in
this environment.

## Backup, restore, and recovery

Compose persists PostgreSQL data in a named Docker volume. No repository
backup schedule, backup command wrapper, retention policy, point-in-time
recovery configuration, restore runbook, or recovery test was found. The
volume is persistence across container recreation, not a backup. Configure
and verify backups outside this codebase before treating production data as
recoverable.
