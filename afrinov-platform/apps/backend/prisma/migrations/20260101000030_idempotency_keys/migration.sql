-- Idempotency keys for retry-safe mutations (TD-019, API principle 3).
--
-- A client sends an `Idempotency-Key` header with a mutating request. The first
-- request runs and its response is stored here; a repeat with the same key and
-- the same body replays the stored response instead of posting the movement a
-- second time. The unique (actor, endpoint, key) index is the concurrency
-- control: two simultaneous retries race on it and the loser replays.
--
-- Additive and forward-only: a new table and its indexes, no existing column or
-- row is touched.

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_actor_id_endpoint_key_key" ON "idempotency_keys"("actor_id", "endpoint", "key");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
