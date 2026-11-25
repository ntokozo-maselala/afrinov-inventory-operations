-- An approved adjustment's posting is a step of its own in its history,
-- COMPLETED, naming the movement it posted (ADR-045). seq keeps the steps in
-- the order they were written: APPROVED and COMPLETED share a time. The new
-- enum value is used in the next migration, not this one.

-- AlterEnum
ALTER TYPE "AdjustmentRequestEventKind" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "adjustment_request_events" ADD COLUMN     "seq" SERIAL NOT NULL,
ADD COLUMN     "transaction_id" TEXT;
