-- A project's status decides whether it is active (ADR-038, system audit E2).
-- The two were set separately, so a project could read as active and
-- cancelled at once, and rules read different ones. From now on Completed and
-- Cancelled mean inactive and every other status active; the application sets
-- both together. Status keeps to the five values the application uses: a row
-- with any other stops this migration, to be put right by hand, rather than
-- being guessed at.
UPDATE "projects" SET "active" = ("status" NOT IN ('COMPLETED', 'CANCELLED'));

ALTER TABLE "projects"
ADD CONSTRAINT "projects_status_check" CHECK ("status" IN ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
ADD CONSTRAINT "projects_active_follows_status" CHECK ("active" = ("status" NOT IN ('COMPLETED', 'CANCELLED')));
