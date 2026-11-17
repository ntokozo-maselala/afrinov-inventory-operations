-- Each request approved before ADR-045 was posted when it was approved: it
-- gets its COMPLETED step, by its approver at that time, after its APPROVED one.
INSERT INTO "adjustment_request_events" ("id", "request_id", "kind", "actor_id", "at", "quantity", "reason_code", "reason_note", "recipient_id", "value", "transaction_id")
SELECT gen_random_uuid()::text, r."id", 'COMPLETED', r."decided_by_id", r."decided_at", r."quantity", r."reason_code", r."reason_note", r."recipient_id", r."value", r."transaction_id"
FROM "adjustment_requests" r
WHERE r."status" = 'APPROVED' AND r."decided_by_id" IS NOT NULL AND r."decided_at" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "adjustment_request_events" e WHERE e."request_id" = r."id" AND e."kind" = 'COMPLETED');
