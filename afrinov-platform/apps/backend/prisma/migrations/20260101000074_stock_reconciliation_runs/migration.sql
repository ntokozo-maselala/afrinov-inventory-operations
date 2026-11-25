-- The daily stock reconciliation (ADR-047). Once a day the backend checks that
-- every stored balance still equals its ledger, none is below zero, every
-- issue adds up and the stock floor constraint is in place, and records the
-- result here; Admins see the newest on the Dashboard. A database CHECK can't
-- compare a balance with the sum of other rows, so this is how a balance that
-- has drifted from its ledger is found within a day.
--
-- Forward-only and additive: a new table, nothing else changes.
-- Rollback: prisma/rollbacks/20260101000074_stock_reconciliation_runs.sql.

-- CreateTable
CREATE TABLE "stock_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balances" INTEGER NOT NULL DEFAULT 0,
    "issues" INTEGER NOT NULL DEFAULT 0,
    "problem_count" INTEGER NOT NULL DEFAULT 0,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "detail" TEXT,

    CONSTRAINT "stock_reconciliation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_reconciliation_runs_status_check" CHECK ("status" IN ('OK', 'DRIFT', 'FAILED')),
    CONSTRAINT "stock_reconciliation_runs_problem_count_check" CHECK ("problem_count" >= 0)
);

-- CreateIndex
CREATE INDEX "stock_reconciliation_runs_finished_at_idx" ON "stock_reconciliation_runs"("finished_at");
