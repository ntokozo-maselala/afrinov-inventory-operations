-- Password lifecycle and sign-in lockout (PRA-05, PRA-09).
--
-- Additive only: four columns with safe defaults, so existing users keep
-- signing in exactly as before. `password_changed_at` stays NULL until a
-- password is changed or reset; tokens issued before it are then refused.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "password_changed_at" TIMESTAMP(3);
