# Backup & Recovery

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** feature/audit-p1-go-live-safety (ADR-037), 2026-11-11

Once the workbook is retired, the database is the only record of stock, so it
is backed up every evening, copied off the server, and a restore is tested
every three months (system audit H2, risk OPS-01, ADR-037). The **backup
service** in `apps/backend/backup` does the backing up and the restore test,
and records each run so Admins see on the Dashboard when something is wrong.

What was tried on 11 November 2026, on throwaway databases: a scheduled
backup at the set time; backup, encryption and copy to an off-site folder; the
restore test from the newest off-site copy, which matched the backup's figures
and dropped its copy afterwards; and the failures (no key, wrong key, no
off-site store), each refused and recorded. CI repeats the backup and restore
test on every backend change. The Azure setup script's commands and flags were checked against the Azure CLI
(2.92), and rclone in the backup image reads the configuration it writes;
neither has been run against a real Azure account yet.

## Who and where

The owner asked for the best recommendation on who owns backups and where
they are kept, then asked for it to be done (2026-11-11). The values below are
that recommendation, adopted on the owner's instruction; change any of them
here if the business decides otherwise.

| What | Value | Decided by |
|---|---|---|
| Runs and checks backups | The Admin who looks after the server; the second Admin covers when they are away. The system keeps two Admins once two exist (ADR-036) | RECOMMENDED |
| Accountable | The business owner: reads the restore-test record each quarter and signs it off | RECOMMENDED |
| How often | Daily at 18:30, after the store closes (`BACKUP_AT`) | RECOMMENDED |
| Kept | 7 days on the server's backup disk; off site, 30 daily copies and 12 monthly ones | RECOMMENDED |
| Where | A second disk on the server, and **Azure Blob Storage in South Africa North (Johannesburg)**, geo-redundant to South Africa West (Cape Town), Cool tier | Adopted, RECOMMENDED |
| Protection | Encrypted before it is written anywhere; every file in the Azure container is locked against change or deletion for 30 days (version-level immutability), and the backup service's access can add and read but not delete | Adopted, RECOMMENDED |
| Restore test | Once before go-live, then every three months, and after any change of host | RECOMMENDED |
| Most data that can be lost (RPO) | One working day | RECOMMENDED, see `disaster-recovery.md` |

**Why Azure:** Afrinov's email already runs on Microsoft 365 (its mail goes
through `afrinov-co-za.mail.protection.outlook.com`), so the same Microsoft
account, sign-in and bill cover backups, with nobody new to manage. Azure
has two South African regions, so the geo-redundant copy in Cape Town stays in
the country too. At this size (a few megabytes a day) storage costs a few
rand a month.

**Why these:** a backup holds personal information (names, PIN hashes,
signatures and slip photos), so it is encrypted and kept in South Africa,
which avoids POPIA's rules on sending personal information abroad. Two places
means one fire, theft or failed disk can't take both the database and its
backups. A deletion lock means neither a mistake nor ransomware on the server
can delete the off-site copies. The person who runs the server is the first
to see a failed backup on the Dashboard; the owner signing off the restore
test is what stops "we have backups" being assumed rather than known.

## What the backup service does

Every day at `BACKUP_AT` (South African time) it:

1. dumps the database (`pg_dump`, one compressed file), counting key figures
   (movements, balances, units on hand, users, migrations) before and after;
2. checks the dump lists the tables it should (42 at migration `…056`);
3. encrypts it with the backup key (AES-256, `gpg`), so no unencrypted copy is
   ever written to disk;
4. keeps it, with its figures, on the backup disk, and removes copies older
   than `BACKUP_KEEP_DAYS` (7);
5. copies both to the off-site store under `daily/`, and on the 1st of the
   month under `monthly/` too;
6. records the run in the database. A failure is recorded with its reason.

The Dashboard shows Admins a **Backups** card when the last backup failed, no
backup succeeded in the last 26 hours, the last one never left the server, or
no restore test passed in the last 92 days. **Settings → Data & backup** shows
the state and the latest runs.

## Setting it up

The service is `backup` in `apps/backend/docker-compose.yml` and starts with
the stack. On the server, from `apps/backend`:

1. **The key.** Make a long random passphrase, readable by the service (it
   runs as uid 70):

   ```sh
   mkdir -p secrets
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" > secrets/backup_key
   sudo chown 70 secrets/backup_key && sudo chmod 400 secrets/backup_key
   ```

   Both Admins store the passphrase in a password manager, and the business
   owner keeps a sealed paper copy. **Lose every copy of the key and every
   backup is lost with it.** `secrets/` is git-ignored.

2. **The backup disk.** Point `BACKUP_DISK` at a folder on a second disk,
   writable by uid 70, for example `BACKUP_DISK=/mnt/backup/afrinov` (then
   `sudo chown 70 /mnt/backup/afrinov`). Without it, copies go to a Docker
   volume on the database's own disk.

3. **The off-site store.** An Admin with the Azure CLI, signed in to
   Afrinov's Microsoft account (`az login`), runs:

   ```sh
   bash backup/azure-setup.sh
   ```

   It creates the storage account in South Africa North (geo-redundant to
   Cape Town, Cool tier, HTTPS only, no public access), a container whose files
   are locked for 30 days, rules that remove `daily/` copies after 31 days and
   `monthly/` after 366, and access for the backup service that can add, read
   and list but not delete, for a year. It writes `secrets/rclone.conf` and
   prints the rest. Then set `BACKUP_REMOTE=offsite:afrinov-backups`. Keep the
   storage account name it prints with the backup key.

   After a week of good backups, lock the 30-day rule with the command the
   script prints: once locked, nobody, Admins included, can shorten or remove
   it. Version-level immutability is marked preview in the Azure CLI.

   **Every year** before the access expires, renew it:
   `ACCOUNT=<name> RG=rg-afrinov-backups bash backup/azure-setup.sh renew`.
   If it lapses, backups stay on the server and the Dashboard shows them
   failing to copy off site.

   Until this step is done, backups stay on the server and the Dashboard says
   so.

4. **Start it, and take one now:**

   ```sh
   docker compose up -d backup
   docker compose run --rm backup now
   docker compose logs backup
   ```

5. **Test a restore** before go-live (step below), and record it in
   `docs/engineering/VERIFICATION_EVIDENCE.md`.

## The restore test (every three months)

```sh
docker compose run --rm --entrypoint /opt/afrinov-backup/restore.sh backup latest --drill
```

It fetches the newest **off-site** copy (the one that matters after losing the
server), decrypts it, restores it into a new database, compares the figures
with those taken at backup time, records the result for the Dashboard, and
drops the copy. A wrong key, a damaged file or differing figures fail the test
and say why. The business owner reads the result under Settings → Data &
backup and signs it off.

## Restoring in earnest

1. Restore into a **new** database, never over the live one:

   ```sh
   docker compose run --rm --entrypoint /opt/afrinov-backup/restore.sh backup latest --into afrinov_restored
   ```

   Use a file name instead of `latest` for an older copy, for example
   `daily/afrinov-2026-11-10_183000.dump.gpg` or one on the backup disk.

2. Run the read-only checks against it, with `DATABASE_URL` pointing at
   `afrinov_restored`:

   ```sh
   npm run check:issued-stock --workspace=@afrinov/backend   # balances equal the ledger, none negative
   npm run check:catalogue --workspace=@afrinov/backend
   npm run check:item-status --workspace=@afrinov/backend
   npm run check:receipts --workspace=@afrinov/backend
   ```

3. Point the backend's `DATABASE_URL` at it and restart the backend.

4. Anything entered after the backup was taken is gone. Collect that day's
   paper slips and enter them again, oldest first. Retry keys are kept for 24
   hours only, so a slip entered twice is not caught: check Movements before
   entering each one.

## Not covered here

- Point-in-time recovery (to a minute rather than a day) needs WAL archiving
  from the host; decide it with the host.
- Slip photos and quotation PDFs are stored in the database, so they are in
  every backup. There are no files on disk to back up separately.

## Evidence
- `afrinov-platform/apps/backend/backup/` — `backup.sh`, `restore.sh`, `run.sh`, `Dockerfile`, `azure-setup.sh`
- `afrinov-platform/apps/backend/docker-compose.yml` — the `backup` service
- `afrinov-platform/apps/backend/src/modules/backups/backup-status.ts` — what the Dashboard is told
- `.github/workflows/backend-ci.yml` — the backup and restore drill
- `afrinov-platform/apps/backend/src/shared/idempotency.ts` — keys kept 24 hours
