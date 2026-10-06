# Backup & Recovery

Automated daily database backups with point-in-time recovery where the
hosting platform supports it, given this becomes the sole system of record
for inventory after cutover (the spreadsheets are frozen, not a live
fallback). Test restore procedure at least once before go-live, not for the
first time during an actual incident.
