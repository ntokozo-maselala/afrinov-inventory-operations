# Database assurance

How database changes are verified, what the current schema/migration state is,
and the recovery considerations for the migration added in this workstream.

## Integrity model

- `inventory_transactions` is the ledger and is append-only through the API
  (ADR-002). Corrections are made by reversal (ADR-005), never by editing or
  deleting a posted row.
- `inventory_balances` is a materialised sum of the ledger for a
  `(material_id, location_id)` pair, recomputed after every movement. The
  integration helper `ledgerAndBalance()` asserts the ledger sum equals the
  stored balance after each workflow.
- Materials reconciles with Stock and Tools (ADR-031): `npm run check:catalogue`
  prints how the pages relate, and fails if an item on either isn't on Materials
  or the tabs don't add up to the catalogue, read-only.
- An item's status is one record (ADR-033): `npm run check:item-status` fails if
  an item's active flag disagrees with its newest `material_status_changes` row,
  and lists inactive items still holding stock, read-only. A status change is
  never a ledger line, so it cannot affect a balance.
- A slip is confirmed once, by the right person (ADR-034): a partial unique
  index allows one confirmation per slip, and `npm run check:receipts` fails if
  a confirmation names a slip that doesn't exist or a worker's slip was
  confirmed by someone else. It also lists slips still waiting, disputed or
  changed after they were confirmed, read-only. A confirmation never moves stock.
- An issue's figures add up (ADR-026): issued = returned + used up + broken +
  still out, with still out never negative. `npm run check:issued-stock`
  (`src/modules/inventory/issued-stock-check.ts`) checks that, and the
  ledger sums, across a whole database, read-only; `integration/consumable-math.real-http.test.ts`
  runs it after every operation on issued stock.
- Balance-changing workflows and PO-receipt workflows take transaction-scoped
  PostgreSQL advisory locks in a stable `(materialId, locationId)` order, so
  concurrent movements serialize instead of both passing a read-then-write
  check. This is the remediation for the prior audit's DATA-01/02/04 findings.

## Schema and migration state

- 27 migrations, applied in order, on a clean PostgreSQL 16 database.
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
  returns an **empty** diff against a freshly migrated database, i.e. the
  committed migrations reproduce the schema exactly. This is now enforced in CI
  (`backend-ci.yml`, `migration-drift` job).

## Proof of receipt (ADR-034)

Migration `20260101000053_receipt_confirmations` only adds: two tables, three
enums, four columns on `recipients` (all empty or zero), a partial unique index,
two CHECKs and three settings rows. It changes no existing row, so it needs no
pre-flight query. After deploying, `check:receipts` should report no slips
confirmed and every rule kept. Signatures and slip photos older than
`inventory.receiptImageKeepMonths` are removed hourly by the server, which marks
`image_removed_at` and keeps the record. To roll back, redeploy the previous
version and leave the tables: the old code ignores them.

## Item status record (ADR-033)

Migration `20260101000051_material_status_changes` only adds: a table, its
indexes and enum, then a copy of past status changes from the audit log. It
changes no existing row. Before deploying it, run this on the target database:

```sql
SELECT count(*) FROM audit_log_entries
WHERE entity_type = 'Material' AND action = 'UPDATE'
  AND ("after" ? 'active')
  AND ("before"->>'active') IS DISTINCT FROM ("after"->>'active')
  AND (actor_id IS NULL OR actor_id NOT IN (SELECT id FROM users));
```

It must return 0: `actor_id` is required, so a change made by no known user
stops the migration. After deploying, run `check:item-status`,
`check:catalogue` and `check:issued-stock`, and clear any inactive item the
first one lists: reactivate it, issue or write off what it holds, and deactivate
it again. Run `check:item-status` before the rule goes live, so the size of that
job is known. To roll back, redeploy the previous version and leave the table:
the old code ignores it, and `check:item-status` lists any change made meanwhile.

## DATA-03 — missing foreign keys (fixed)

**Problem.** `schema.prisma` declares:

```prisma
material Material @relation(fields: [materialId], references: [id], onDelete: Restrict)
location Location @relation(fields: [locationId], references: [id], onDelete: Restrict)
```

but the initial migration created `inventory_balances` with only its composite
primary key. No later migration added the constraints, so the database did not
enforce the relations the application assumed. An out-of-band write or an
application defect could leave a balance row referencing a deleted material or
location.

**Evidence.** Before the fix, the drift check emitted exactly two statements:

```sql
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_material_id_fkey"
  FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

**Fix.** Migration `20260101000027_inventory_balance_foreign_keys`. It is
forward-only and additive — no column or row is modified.

**Why it cannot half-apply.** The migration runs inside a single `DO` block
that first takes an `ACCESS EXCLUSIVE` lock on `inventory_balances`, then counts
orphan rows. If any orphan exists it raises an exception with the counts and
refuses. The `DO` block is one transaction, so the refusal is atomic: no partial
schema change is left behind. The same pattern is used by
`20260101000022_drop_racks`.

**What the refusal does not avoid.** The failed-migration state is real. Prisma
records the attempt in `_prisma_migrations` with a null `finished_at`, and every
subsequent `prisma migrate deploy` stops with:

```
Error: P3009
migrate found failed migrations in the target database, new migrations will not be applied.
The `20260101000027_inventory_balance_foreign_keys` migration started at … failed
```

The refusal is therefore safe for the schema, not invisible to the operator.
Clearing it requires an explicit step (see the recovery procedure below).

**Verified behaviour (see `VERIFICATION_EVIDENCE.md`):**

- On a clean database: applies successfully.
- On a database seeded with one orphan row: refuses with
  `inventory_balances has 1 orphan material row(s) and 1 orphan location row(s)...`.
- After deleting the orphan and clearing the failed migration record: applies.
- After applying: inserting a balance with a non-existent material is rejected
  by `inventory_balances_material_id_fkey`.

**Operator guidance.** On a real environment, check for orphans before
deploying:

```sql
SELECT count(*) FROM inventory_balances b
  WHERE NOT EXISTS (SELECT 1 FROM materials m WHERE m.id = b.material_id)
     OR NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = b.location_id);
```

If the count is non-zero, resolve the rows (repair the reference or remove the
balance, in consultation with the data owner) before deploying. If the
migration has already refused, Prisma records it as failed and later deploys
stop until the record is cleared:

```sh
npx prisma migrate resolve --rolled-back 20260101000027_inventory_balance_foreign_keys
```

then deploy again. Do not clear the record without first resolving the orphans.

## Concurrency assurance

The prior audit's DATA-01/DATA-02/DATA-04 hazards (concurrent issues
overdrawing stock, duplicate goods-receipt posting, over-receipt of a PO line)
are covered by advisory-lock serialization and by real-PostgreSQL integration
tests that race two requests and assert exactly one succeeds. Those suites pass
here (see `VERIFICATION_EVIDENCE.md`).

## Backup, restore and rollback

A backup service (`apps/backend/backup`, ADR-037) backs the database up every
evening, encrypted, to a backup disk and an off-site store, and its restore
test restores the newest off-site copy into a new database and compares it
with the figures taken at backup time. Each run is recorded in `backup_runs`
and shown to Admins on the Dashboard. CI runs a backup and a restore test on
every backend change (`backend-ci.yml`, "Backup and restore drill"). Still
**not verifiable from this repository**: the production key, disk and cloud
store, a restore test there, and agreed recovery objectives (RPO/RTO). Those
keep finding OPS-01 open as a release gate. The migration itself is forward-only and additive,
so application rollback does not require a database rollback; the new
constraints can be dropped if necessary without data loss.

## Known limitation

A migration that applies cleanly to an **empty** database is not proof it is
safe for a **populated** one. The orphan preflight and the `ACCESS EXCLUSIVE`
lock reduce that risk for this migration, and the refusal path was exercised
against a database containing a deliberately orphaned row. Operators must still
run the orphan preflight above against the real database before deploying.
