-- Backups (ADR-037, system audit H2). The backup service records each backup
-- and restore test here, so Admins see on the Dashboard when backups are
-- late, failing or never left the server. The application only reads it.
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_name" TEXT,
    "size_bytes" BIGINT,
    "offsite" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT,
    "counts" JSONB,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_runs_kind_check" CHECK ("kind" IN ('BACKUP', 'RESTORE_TEST')),
    CONSTRAINT "backup_runs_status_check" CHECK ("status" IN ('OK', 'FAILED'))
);

CREATE INDEX "backup_runs_kind_finished_at_idx" ON "backup_runs"("kind", "finished_at");
