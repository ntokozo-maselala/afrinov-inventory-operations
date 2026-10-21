-- Stores and Projects materials (materials sections roadmap, Phase 1).
-- A Projects material (category PROJECT_MATERIAL) belongs to one project.
-- Existing ones have no project yet; they are assigned one in the app.
ALTER TABLE "materials" ADD COLUMN "project_number" TEXT;
ALTER TABLE "materials"
  ADD CONSTRAINT "materials_project_number_fkey" FOREIGN KEY ("project_number")
  REFERENCES "projects"("project_number") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "materials_project_number_idx" ON "materials"("project_number");

-- Projects material is bought per job and never re-ordered, so it has no Required Stock.
UPDATE "materials" SET "required_stock" = 0 WHERE "category" = 'PROJECT_MATERIAL';
