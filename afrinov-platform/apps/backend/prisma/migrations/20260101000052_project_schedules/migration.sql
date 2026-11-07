-- Job tracking (ADR-032, Project Tracking Roadmap, Phase 1): a project's work as
-- one or more schedules of steps, each step with a baseline, a forecast and an
-- actual, its progress and the user assigned. Only adds tables, a permission and
-- settings rows.

-- CreateEnum
CREATE TYPE "ProjectScheduleStatus" AS ENUM ('PLANNING', 'ACTIVE', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "project_schedules" (
    "id" TEXT NOT NULL,
    "project_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectScheduleStatus" NOT NULL DEFAULT 'PLANNING',
    "due_date" DATE,
    "also_covers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_steps" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "baseline_start" DATE,
    "baseline_end" DATE,
    "forecast_start" DATE,
    "forecast_end" DATE,
    "actual_start" DATE,
    "actual_end" DATE,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "assignee_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_schedules_project_number_idx" ON "project_schedules"("project_number");

-- CreateIndex
CREATE INDEX "project_schedules_status_idx" ON "project_schedules"("status");

-- CreateIndex
CREATE INDEX "project_steps_schedule_id_position_idx" ON "project_steps"("schedule_id", "position");

-- CreateIndex
CREATE INDEX "project_steps_assignee_id_idx" ON "project_steps"("assignee_id");

-- AddForeignKey: a project with schedules can't be deleted or renumbered under them.
ALTER TABLE "project_schedules" ADD CONSTRAINT "project_schedules_project_number_fkey" FOREIGN KEY ("project_number") REFERENCES "projects"("project_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_schedules" ADD CONSTRAINT "project_schedules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_steps" ADD CONSTRAINT "project_steps_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "project_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_steps" ADD CONSTRAINT "project_steps_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Changing any project's schedules. Admin holds it; a project's own manager may
-- change that project's schedules without it (project-schedule.service.ts).
-- Added here, with Admin's grant, so existing databases get it without
-- re-running the seed.
INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'manage:project_schedule', 'manage:project_schedule')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."name" = 'ADMIN' AND p."code" = 'manage:project_schedule'
ON CONFLICT DO NOTHING;

-- The step templates a new schedule starts from, and the days the business is
-- closed, which working days leave out. Both are kept in Settings → Projects.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at") VALUES
  ('projects.stepTemplates',
   '"Workshop job: Kick-off, Engineering, Procurement, Manufacturing, FAT, Packaging, Data Pack, Delivery, Postmortem, Closure\nSite job: Kick-off, Site induction and safety file, Engineering, Procurement, Manufacturing, FAT, Delivery, Site installation, Commissioning, Postmortem, Closure\nBuy and deliver: Kick-off, Procurement, Packaging, Data Pack, Delivery, Closure\nMaintenance visit: Site induction and safety file, Site inspection, Oil testing, Site report, Closure"',
   'string', 'projects',
   'The step lists a new schedule can start from, one per line: the template''s name, a colon, then its steps separated by commas. A schedule''s steps can be changed after it starts from one.', true, CURRENT_TIMESTAMP),
  ('projects.closedDays',
   '""',
   'string', 'projects',
   'Days the business is closed, such as public holidays and shutdowns, one per line as YYYY-MM-DD with an optional note after it. Weekends are always left out. Durations and lateness are counted in working days.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
