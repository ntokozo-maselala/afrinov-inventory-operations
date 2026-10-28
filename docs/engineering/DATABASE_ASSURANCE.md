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

**Not verifiable from this repository.** There is no backup/restore runbook, no
restore drill evidence, and no recovery objectives (RPO/RTO). This is finding
OPS-01 and is a release gate. The migration itself is forward-only and additive,
so application rollback does not require a database rollback; the new
constraints can be dropped if necessary without data loss.

## Known limitation

A migration that applies cleanly to an **empty** database is not proof it is
safe for a **populated** one. The orphan preflight and the `ACCESS EXCLUSIVE`
lock reduce that risk for this migration, and the refusal path was exercised
against a database containing a deliberately orphaned row. Operators must still
run the orphan preflight above against the real database before deploying.
