# Deployment Architecture

## v1 target
Single application server (or small container) + managed PostgreSQL
instance. No queue, no cache layer required at current transaction volumes
(the AS-IS `*Issued` sheets show low thousands of rows per category per
year — comfortably within a single Postgres instance's capability).

## Environments
`local` (developer machines) → `staging` (mirrors production, used for
migration rehearsal and UAT) → `production`.

## Deployment method
Standard build → migrate database → deploy application, via CI/CD (see
`12-operations/ci-cd.md`). No blue/green or multi-region complexity needed
at this scale.
