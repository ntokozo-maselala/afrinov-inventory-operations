# Backup & Recovery

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Planned — nothing in the repository implements backups.** The compose
stack keeps PostgreSQL data in the named volume `afrinov_pg` with no backup
job. Intent: automated daily database backups with point-in-time recovery
where the hosting platform supports it, since this becomes the sole system
of record after cutover; test the restore procedure at least once before
go-live.

## Evidence
- `afrinov-platform/apps/backend/docker-compose.yml` — volume `afrinov_pg`, no backup service
