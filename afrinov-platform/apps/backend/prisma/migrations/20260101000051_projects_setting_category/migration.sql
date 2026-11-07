-- Job tracking's settings (Project Tracking Roadmap, Phase 1) get their own
-- Settings category. On its own, as Postgres can't use a new enum value in the
-- transaction that adds it; the next migration inserts rows in it.
ALTER TYPE "SettingCategory" ADD VALUE IF NOT EXISTS 'projects';
