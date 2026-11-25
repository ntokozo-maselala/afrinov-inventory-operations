-- Requests their own asker turned down were withdrawals, stored as REJECTED
-- until now (ADR-044). The audit log keeps what it recorded at the time.
UPDATE "adjustment_requests"
SET "status" = 'WITHDRAWN'
WHERE "status" = 'REJECTED' AND "decided_by_id" = "requested_by_id";
