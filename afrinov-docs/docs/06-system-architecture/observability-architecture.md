# Observability Architecture

## Logging
Structured (JSON) logs for every request and every domain event
(`InventoryIssued`, `GoodsReceived`, etc.) with actor, entity id, and
outcome — this is the operational equivalent of the audit trail and should
make "why did stock change" answerable both from the database and from logs.

## Metrics
Request latency/error rate per endpoint; business metrics worth tracking
from day one given the AS-IS pain points: count of below-threshold
materials, count of ad hoc (non-PO) receipts, count of failed
insufficient-balance issue attempts (a proxy for stock-outs).

## Tracing
Not required at v1 scale (single deployable, no distributed calls); revisit
if/when a module is split into a separate service.

## Alerting
Operational alerts (error rate, downtime) separate from business alerts
(low stock) — the former goes to engineering, the latter to the Store
Controller/Procurement role inside the product itself.
