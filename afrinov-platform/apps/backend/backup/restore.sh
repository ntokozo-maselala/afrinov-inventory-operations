#!/bin/sh
# Restore a backup into a new, empty database (ADR-037), never over the live
# one, and check the copy against the figures recorded when it was taken.
#
#   restore.sh latest [--drill] [--into <name>]
#   restore.sh <file.dump.gpg | daily/<file> | monthly/<file>> [--drill] [--into <name>]
#
# "latest" is the newest off-site copy when BACKUP_REMOTE is set (the one that
# matters after losing the server), else the newest on this server. --drill is
# the quarterly test: it records the result for the Dashboard and drops the
# copy afterwards. Without it, the restored database is kept for the backend's
# DATABASE_URL to be pointed at.
set -eu
. "$(dirname "$0")/lib.sh"

usage() { echo "usage: restore.sh latest|<file> [--drill] [--into <database>]" >&2; exit 2; }
[ $# -ge 1 ] || usage
source_name=$1; shift
drill=false
into="afrinov_restored_$(date +%Y%m%d_%H%M%S)"
while [ $# -gt 0 ]; do
  case "$1" in
    --drill) drill=true ;;
    --into) [ $# -ge 2 ] || usage; into=$2; shift ;;
    *) usage ;;
  esac
  shift
done
case "$into" in *[!a-z0-9_]*|'') echo "the database name may hold only a-z, 0-9 and _" >&2; exit 2 ;; esac

started=$(now_iso)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() {
  log "FAILED: $1"
  if [ "$drill" = true ]; then record RESTORE_TEST FAILED "$started" "${file:-}" "" false "$1" ""; fi
  exit 1
}

if problem=$(key_problem); then fail "$problem"; fi

# Fetch the copy and its figures.
if [ "$source_name" = latest ]; then
  if [ -n "${BACKUP_REMOTE:-}" ]; then
    source_name="daily/$(rclone -q lsf --include 'afrinov-*.dump.gpg' "$BACKUP_REMOTE/daily" | sort | tail -n 1)"
    [ "$source_name" != "daily/" ] || fail "no copy found at $BACKUP_REMOTE/daily"
  else
    source_name=$(ls -1 "$BACKUP_DIR" | grep '^afrinov-.*\.dump\.gpg$' | sort | tail -n 1 || true)
    [ -n "$source_name" ] || fail "no copy found in $BACKUP_DIR"
  fi
fi
file=$(basename "$source_name")
if [ -f "$BACKUP_DIR/$source_name" ] || [ -f "$source_name" ]; then
  src=$( [ -f "$source_name" ] && echo "$source_name" || echo "$BACKUP_DIR/$source_name" )
  cp "$src" "$work/$file"
  manifest_src="${src%.dump.gpg}.dump.json"
  [ -f "$manifest_src" ] && cp "$manifest_src" "$work/manifest.json"
elif [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone -q copyto "$BACKUP_REMOTE/$source_name" "$work/$file" || fail "could not fetch $source_name from $BACKUP_REMOTE"
  rclone -q copyto "$BACKUP_REMOTE/${source_name%.dump.gpg}.dump.json" "$work/manifest.json" 2>/dev/null || true
else
  fail "$source_name was not found"
fi
log "restoring $file into $into"

dump="$work/${file%.gpg}"
case "$file" in
  *.gpg) decrypt "$work/$file" "$dump" || fail "could not decrypt $file: wrong key, or a damaged file" ;;
  *) mv "$work/$file" "$dump" ;;
esac

exists=$(psql -X -tA -d postgres -v name="$into" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'name';
SQL
)
[ -z "$exists" ] || fail "database $into already exists; restore into a new one"
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$into\"" || fail "could not create $into"
pg_restore --no-owner --exit-on-error -d "$into" "$dump" 2>"$work/err" || fail "pg_restore stopped: $(head -c 300 "$work/err")"

got=$(counts_of "$into") || fail "the restored copy can't be read"
result="restored $file into $into: $got"
if [ -f "$work/manifest.json" ]; then
  want=$(sed -n 's/.*"counts":\({[^}]*}\).*/\1/p' "$work/manifest.json")
  settled=$(sed -n 's/.*"settled":\([a-z]*\).*/\1/p' "$work/manifest.json")
  if [ "$got" != "$want" ]; then
    if [ "$settled" = true ]; then fail "the restored copy differs from the backup: got $got, expected $want"; fi
    log "the copy differs from the figures taken just after the dump ($want): something moved while it ran"
  else
    result="$result, matching the backup"
  fi
else
  log "no figures were kept with this copy, so it was not compared"
fi
log "$result"

if [ "$drill" = true ]; then
  record RESTORE_TEST OK "$started" "$file" "" false "$result" "$got"
  psql -X -q -d postgres -c "DROP DATABASE \"$into\"" || log "could not drop $into; drop it by hand"
  log "restore test passed; $into dropped"
else
  log "kept $into. Run the backend's check:* scripts against it, then point DATABASE_URL at it."
fi
