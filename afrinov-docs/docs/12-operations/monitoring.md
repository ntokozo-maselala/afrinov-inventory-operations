# Monitoring

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Implemented:** health checks for an external monitor to poll —
`GET /health` (process alive) and `GET /health/ready` (database reachable;
503 when not), at the root and under `/api/v1`. The Settings → System page
shows API status from `/api/v1/health`.

**Planned** (no metrics are collected): request latency and error rate per
endpoint; count of refused `INSUFFICIENT_BALANCE` attempts (stock-out
proxy); count of materials below Required Stock (available on demand from
`/reports/stock-value` and the Stock status page, not as a metric); count
of receipts without a purchase order.

## Evidence
- `afrinov-platform/apps/backend/src/server.ts:211-222`
- `afrinov-platform/apps/backend/src/modules/health/health.routes.ts:17-33`
- `afrinov-platform/apps/frontend/src/pages/SettingsSections.tsx` — `GET /health`
