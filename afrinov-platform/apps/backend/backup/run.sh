#!/bin/sh
# The backup service (ADR-037): one backup a day at BACKUP_AT (HH:MM, in TZ,
# 18:30 Africa/Johannesburg by default, after the store closes), for as long
# as the container runs. A failed backup is recorded and the next day's still
# runs. "run.sh now" takes one backup and exits.
set -eu
. "$(dirname "$0")/lib.sh"

if [ "${1:-}" = now ]; then exec "$(dirname "$0")/backup.sh"; fi

at="${BACKUP_AT:-18:30}"
case "$at" in [0-2][0-9]:[0-5][0-9]) ;; *) log "BACKUP_AT must be HH:MM (got $at)"; exit 2 ;; esac
log "backing up daily at $at ($(date +%Z)) to ${BACKUP_REMOTE:-this server only}"

while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) $at" +%s)
  [ "$next" -gt "$now" ] || next=$((next + 86400))
  sleep $((next - now))
  "$(dirname "$0")/backup.sh" || log "backup failed; it is recorded, and tomorrow's will run"
done
