-- An item's status changes as records of their own, so Movements can list them
-- with no quantity (ADR-032). Only adds: nothing that exists is changed.

-- CreateEnum
CREATE TYPE "MaterialStatusReason" AS ENUM ('OBSOLETE', 'SUPERSEDED', 'SUPPLIER_DISCONTINUED', 'CREATED_IN_ERROR', 'BACK_IN_USE', 'STOCK_CAME_BACK', 'DEACTIVATED_IN_ERROR', 'OTHER');

-- CreateTable
CREATE TABLE "material_status_changes" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "reason_code" "MaterialStatusReason",
    "note" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_status_changes_material_id_created_at_idx" ON "material_status_changes"("material_id", "created_at");

-- CreateIndex
CREATE INDEX "material_status_changes_created_at_idx" ON "material_status_changes"("created_at");

-- AddForeignKey
ALTER TABLE "material_status_changes" ADD CONSTRAINT "material_status_changes_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_status_changes" ADD CONSTRAINT "material_status_changes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Past changes, from the audit log, which has recorded every one as an update
-- of the item. They keep their audit entry's id, time and actor; they have no
-- reason, as none was asked for. A change made by no known user stops this
-- migration: run the pre-flight query in docs/engineering/DATABASE_ASSURANCE.md first.
INSERT INTO "material_status_changes" ("id", "material_id", "active", "actor_id", "created_at")
SELECT a."id", a."entity_id", (a."after"->>'active')::boolean, a."actor_id", a."created_at"
FROM "audit_log_entries" a
WHERE a."entity_type" = 'Material'
  AND a."action" = 'UPDATE'
  AND a."after" ? 'active'
  AND (a."before"->>'active') IS DISTINCT FROM (a."after"->>'active');
