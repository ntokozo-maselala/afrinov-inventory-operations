# Backup & Recovery

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** feature/audit-p1-go-live-safety, 2026-11-11

Once the workbook is retired, the database is the only record of stock, so it
is backed up every day and a restore is tried before go-live (system audit H2,
risk OPS-01). The commands below were run end to end on a throwaway copy on
11 November 2026: dump, restore into an empty database, then the checks in
step 4, which matched row for row.

## Who and how often

| What | Value | Decided by |
|---|---|---|
| Backup owner | *To be named before go-live* | Business owner |
| How often | Daily, after the store closes | RECOMMENDED |
| Kept | 30 daily copies, plus the last copy of each month for 12 months | RECOMMENDED |
| Where | Off the database server: a second machine or cloud storage, not the same disk | RECOMMENDED |
| Restore test | Once before go-live, then every three months, and after any change of host | RECOMMENDED |
| Most data that can be lost (RPO) | One working day | RECOMMENDED, see `disaster-recovery.md` |

The proxy, host and storage are not chosen yet; the commands assume the
Compose stack in `apps/backend/docker-compose.yml`, where the database runs in
the `db` service. On another host, run the same `pg_dump` and `pg_restore`
against its database.

## 1. Take a backup

```sh
# From apps/backend, on the database host. One file, compressed, restorable on its own.
STAMP=$(date +%Y-%m-%d)
docker compose exec -T db pg_dump -U afrinov -d afrinov --format=custom --no-owner \
  > "afrinov-$STAMP.dump"
```

Copy the file off the server, then delete local copies past the keep period.
A backup that has never left the database server is not a backup.

A day's file is small (a demo database with 315 movements is about 300 KB);
watch its size: a sudden drop means something is wrong.

## 2. Check the file before trusting it

```sh
docker compose exec -T db pg_restore --list < "afrinov-$STAMP.dump" | grep -c "TABLE DATA"
```

It lists the tables the file holds (41 at migration `…055`). An error or a
much smaller number means the backup failed.

## 3. Restore

Restore into a **new, empty database**, never over the live one, then switch
the backend's `DATABASE_URL` once the checks pass.

```sh
docker compose exec -T db psql -U afrinov -d postgres -c "CREATE DATABASE afrinov_restored"
docker compose exec -T db pg_restore -U afrinov -d afrinov_restored --no-owner --exit-on-error \
  < "afrinov-$STAMP.dump"
```

`--exit-on-error` stops at the first problem instead of leaving a half
restored database that looks complete.

## 4. Check the restored copy

Point `DATABASE_URL` at the restored database and run the read-only checks:

```sh
npm run check:issued-stock --workspace=@afrinov/backend   # balances equal the ledger, none negative
npm run check:catalogue --workspace=@afrinov/backend      # Materials adds up against Stock and Tools
npm run check:item-status --workspace=@afrinov/backend
npm run check:receipts --workspace=@afrinov/backend
```

Then compare these counts with the live database (or with the figures noted
when the backup was taken). They must be equal:

```sql
SELECT (SELECT count(*) FROM inventory_transactions) AS ledger,
       (SELECT count(*) FROM inventory_balances)     AS balances,
       (SELECT sum(quantity) FROM inventory_balances) AS units,
       (SELECT count(*) FROM users)                  AS users,
       (SELECT count(*) FROM _prisma_migrations)     AS migrations;
```

Finally start the backend against it and sign in. Record the date, the file
restored and who did it in `docs/engineering/VERIFICATION_EVIDENCE.md`; that
record is the evidence the go-live gate asks for.

## 5. After a restore in earnest

Anything entered after the backup was taken is gone. Collect that day's paper
slips and enter them again, oldest first. Retry keys are kept for 24 hours
only, so a slip entered twice is not caught: check Movements before entering
each one.

## Not covered here

- Point-in-time recovery (restoring to a minute rather than a day) needs WAL
  archiving from the host; decide it with the host.
- Uploaded slip photos and quotation PDFs are stored in the database, so they
  are in the dump. There are no files on disk to back up separately.

## Evidence
- `afrinov-platform/apps/backend/docker-compose.yml` — the `db` service and volume `afrinov_pg`
- `afrinov-platform/apps/backend/package.json` — the `check:*` scripts
- `afrinov-platform/apps/backend/src/shared/idempotency.ts` — keys kept 24 hours
