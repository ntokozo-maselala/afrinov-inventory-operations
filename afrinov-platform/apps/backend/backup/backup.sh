#!/bin/sh
# One backup (ADR-037): dump the database, check the dump, encrypt it, keep it
# on the backup disk, copy it off site, and record the run for the Dashboard.
#
#   BACKUP_DIR        where encrypted copies are kept on this server (/backups)
#   BACKUP_KEEP_DAYS  how long they are kept there (7)
#   BACKUP_REMOTE     the off-site store, as rclone names it (for example
#                     "offsite:afrinov-backups"); unset keeps copies here only,
#                     which the Dashboard shows as a warning
#   BACKUP_KEY_FILE   the encryption passphrase (/run/secrets/backup_key)
set -eu
. "$(dirname "$0")/lib.sh"

started=$(now_iso)
name="afrinov-$(date +%Y-%m-%d_%H%M%S).dump"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() {
  log "FAILED: $1"
  record BACKUP FAILED "$started" "${2:-}" "${3:-}" false "$1" ""
  exit 1
}

if problem=$(key_problem); then fail "$problem"; fi
mkdir -p "$BACKUP_DIR"

# Counted before and after the dump: equal means nothing moved while it ran,
# so a restored copy must match these figures exactly.
before=$(counts_of) || fail "could not read the database"
pg_dump --format=custom --no-owner --file="$work/$name" 2>"$work/err" || fail "pg_dump failed: $(head -c 300 "$work/err")"
after=$(counts_of) || fail "could not read the database after the dump"
settled=true
[ "$before" = "$after" ] || settled=false

# A dump that lists too few tables is not trusted (42 at migration ...056).
tables=$(pg_restore --list "$work/$name" | grep -c "TABLE DATA" || true)
[ "$tables" -ge "${BACKUP_MIN_TABLES:-30}" ] || fail "the dump holds only $tables tables"

encrypt "$work/$name" "$BACKUP_DIR/$name.gpg" || fail "encryption failed"
manifest="{\"file\":\"$name.gpg\",\"settled\":$settled,\"counts\":$after}"
printf '%s\n' "$manifest" > "$BACKUP_DIR/$name.json"
size=$(wc -c < "$BACKUP_DIR/$name.gpg" | tr -d ' ')
log "kept $name.gpg ($size bytes, $tables tables) in $BACKUP_DIR"

offsite=false
if [ -n "${BACKUP_REMOTE:-}" ]; then
  # Daily copies; on the 1st, a monthly copy too, so the store's own rules can
  # keep 30 days of daily/ and 12 months of monthly/.
  targets="daily"
  [ "$(date +%d)" = "01" ] && targets="daily monthly"
  for t in $targets; do
    rclone -q copyto "$BACKUP_DIR/$name.gpg" "$BACKUP_REMOTE/$t/$name.gpg" 2>"$work/err" \
      && rclone -q copyto "$BACKUP_DIR/$name.json" "$BACKUP_REMOTE/$t/$name.json" 2>>"$work/err" \
      || fail "kept on this server, but copying off site failed: $(head -c 300 "$work/err")" "$name.gpg" "$size"
  done
  offsite=true
  log "copied off site to $BACKUP_REMOTE ($targets)"
else
  log "BACKUP_REMOTE is not set: this copy stays on this server only"
fi

# Copies on this server past their keep period go; off site, the store's rules decide.
find "$BACKUP_DIR" -maxdepth 1 -name 'afrinov-*' -type f -mtime +"${BACKUP_KEEP_DAYS:-7}" -delete

record BACKUP OK "$started" "$name.gpg" "$size" "$offsite" "" "$manifest"
log "done"
