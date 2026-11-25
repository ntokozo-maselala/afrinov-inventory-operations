-- A request taken back by whoever asked for it is WITHDRAWN, not REJECTED
-- (ADR-044). The value is added here and used in the next migration: a new
-- enum value can't be used in the transaction that adds it.

-- AlterEnum
ALTER TYPE "AdjustmentRequestStatus" ADD VALUE 'WITHDRAWN';
