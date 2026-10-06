# Logging

Structured JSON logs, one entry per request and per domain event
(`InventoryIssued`, `GoodsReceived`, etc.), including actor id, entity id,
and outcome. Never log passwords, tokens, or full audit "before/after"
payloads at INFO level (that data belongs in the audit table, queried
deliberately, not scattered through log aggregation).
