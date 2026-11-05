-- The Sales team's role. On its own, as Postgres can't use a new enum value in
-- the transaction that adds it; the next migration uses it.
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'SALES';
