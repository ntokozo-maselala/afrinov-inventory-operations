#!/bin/sh
# Shared by backup.sh and restore.sh (ADR-037). The database is reached with
# the standard PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-/run/secrets/backup_key}"
# The off-site store's credentials, when given as a file (rclone can also read RCLONE_CONFIG_* variables).
if [ -z "${RCLONE_CONFIG:-}" ] && [ -f /run/secrets/rclone.conf ]; then export RCLONE_CONFIG=/run/secrets/rclone.conf; fi

log() { printf '%s afrinov-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# The encryption key must be there and must not be empty or trivially short.
key_problem() {
  if [ ! -f "$BACKUP_KEY_FILE" ]; then echo "no encryption key at $BACKUP_KEY_FILE"; return 0; fi
  if [ "$(wc -c < "$BACKUP_KEY_FILE")" -lt 20 ]; then echo "the encryption key at $BACKUP_KEY_FILE is shorter than 20 characters"; return 0; fi
  return 1
}

encrypt() { # <in> <out>
  gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
    --passphrase-file "$BACKUP_KEY_FILE" --output "$2" "$1"
}

decrypt() { # <in> <out>
  gpg --batch --yes --quiet --pinentry-mode loopback --decrypt \
    --passphrase-file "$BACKUP_KEY_FILE" --output "$2" "$1"
}

# The figures a restored copy must match, as one line of JSON. The same query
# runs on the live database at backup time and on the restored copy.
COUNTS_SQL="SELECT json_build_object(
  'ledger', (SELECT count(*) FROM inventory_transactions),
  'balances', (SELECT count(*) FROM inventory_balances),
  'units', (SELECT coalesce(sum(quantity), 0)::text FROM inventory_balances),
  'users', (SELECT count(*) FROM users),
  'migrations', (SELECT count(*) FROM _prisma_migrations))"

counts_of() { # [database]
  psql -X -tA -v ON_ERROR_STOP=1 ${1:+-d "$1"} -c "$COUNTS_SQL"
}

# Records a run in backup_runs on the live database, for the Dashboard. A run
# that can't be recorded is still logged, and still fails or succeeds as it did.
record() { # <kind> <status> <started> <file> <size> <offsite> <detail> <counts>
  psql -X -q -v ON_ERROR_STOP=1 \
    -v kind="$1" -v status="$2" -v started="$3" -v file="$4" -v size="$5" \
    -v offsite="$6" -v detail="$7" -v counts="$8" <<'SQL' || log "could not record this run in backup_runs"
INSERT INTO backup_runs (id, kind, status, started_at, finished_at, file_name, size_bytes, offsite, detail, counts)
VALUES (gen_random_uuid()::text, :'kind', :'status',
        (:'started'::timestamptz AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'),
        NULLIF(:'file', ''), NULLIF(:'size', '')::bigint, :'offsite'::boolean,
        NULLIF(:'detail', ''), NULLIF(:'counts', '')::jsonb);
SQL
}
