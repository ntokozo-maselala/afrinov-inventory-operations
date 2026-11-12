-- Passwords can be changed and reset (ADR-036, system audit F1). An Admin's
-- temporary password must be changed at the next sign-in, and a change ends
-- every sign-in that began before it. Existing accounts keep their password.
ALTER TABLE "users"
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "password_changed_at" TIMESTAMP(3);
