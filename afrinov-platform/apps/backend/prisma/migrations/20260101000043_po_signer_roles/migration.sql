-- The roles that sign purchase orders. On their own, as Postgres can't use a
-- new enum value in the transaction that adds it; the next migration uses them.
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'PROCUREMENT_MANAGER';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'DIRECTOR';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'CEO';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'WORKSHOP_MANAGER';
