# Observability Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Logging
**Implemented:** Fastify's built-in pino logger writes one "incoming
request" and one "request completed" line per request (method, URL, status
code, response time) carrying a request id. Business-rule errors
(`ApiError`) are logged at `warn` with their code; unexpected errors at
`error`. Output is JSON, pretty-printed only when `NODE_ENV=development`.
The log level comes from `LOG_LEVEL` (default `info`). Start-up writes an
ordered trace (environment, Node version, database probe result, listening
address).

**Planned:** a structured log entry per domain event (`InventoryIssued`,
`GoodsReceived`, …) with actor, entity id and outcome. Domain events are
dispatched but nothing consumes or logs them (TD-007). Who changed stock
is answerable from the ledger (`inventory_transactions.actor_id`) and, for
some actions, the audit log — not from the logs.

## Metrics
**Planned.** No metrics are collected. Candidates from the AS-IS pain
points: request latency/error rate per endpoint, count of below-threshold
materials, count of receipts without a purchase order, count of rejected
`INSUFFICIENT_BALANCE` attempts (a proxy for stock-outs).

## Health checks
**Implemented:** `GET /health` (process alive) and `GET /health/ready`
(runs `SELECT 1`; 503 when the database is unreachable), served both at the
root and under `/api/v1`.

## Tracing
Not implemented and not required at v1 scale (single deployable).

## Alerting
**Planned** for operational alerts (see `12-operations/alerting.md`).
Business alerts (items below Required Stock) are shown inside the product
on the Stock status page and dashboard.

## Evidence
- `afrinov-platform/apps/backend/src/server.ts:48-70` — logger configuration and request id
- `afrinov-platform/apps/backend/src/server.ts:180-199` — error logging
- `afrinov-platform/apps/backend/src/server.ts:349-412` — start-up trace
- `afrinov-platform/apps/backend/src/server.ts:211-222`, `afrinov-platform/apps/backend/src/modules/health/health.routes.ts:17-33` — health checks
- `afrinov-platform/apps/backend/src/shared/events.ts:20-38` — dispatcher with no registered handlers
