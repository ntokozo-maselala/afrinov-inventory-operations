-- Controls and who may do what (ADR-039, system audit P3).

-- C3: each change of an item's unit cost, with why.
CREATE TABLE "material_cost_changes" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "before" DECIMAL(18,4),
    "after" DECIMAL(18,4),
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_cost_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "material_cost_changes_material_id_created_at_idx" ON "material_cost_changes"("material_id", "created_at");
ALTER TABLE "material_cost_changes" ADD CONSTRAINT "material_cost_changes_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_cost_changes" ADD CONSTRAINT "material_cost_changes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- F3: sign-ins and failed sign-ins, kept 12 months.
CREATE TABLE "sign_in_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_in_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sign_in_events_outcome_check" CHECK ("outcome" IN ('SIGN_IN', 'FAILED', 'THROTTLED', 'SIGN_OUT'))
);
CREATE INDEX "sign_in_events_created_at_idx" ON "sign_in_events"("created_at");
CREATE INDEX "sign_in_events_user_id_created_at_idx" ON "sign_in_events"("user_id", "created_at");
ALTER TABLE "sign_in_events" ADD CONSTRAINT "sign_in_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- F5: a recipient may be a user of the system, so a slip someone issues to
-- themselves is seen. One account per recipient.
ALTER TABLE "recipients" ADD COLUMN "user_id" TEXT;
CREATE UNIQUE INDEX "recipients_user_id_key" ON "recipients"("user_id");
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- C9: the two settings that remove the second person say so (Settings shows
-- each row's description, and the seed never rewrites a row).
UPDATE "settings"
SET "description" = 'When on, adjustments and write-offs worth more than the limit below, or with no unit cost, wait for someone other than whoever asked for them to approve them. Switching it off removes that second person: every write-off posts at once, whatever its value. Switching it off asks for a reason.'
WHERE "key" = 'inventory.requireWriteOffApproval';
UPDATE "settings"
SET "description" = 'When on, a submitted purchase order waits for its signatures. Switching it off removes them: submitting an order approves it in the name of whoever submitted it, whatever its value. Switching it off asks for a reason.'
WHERE "key" = 'purchaseOrders.requireApprovalBeforeProcessing';

-- Two permissions (system audit C3, E3): setting an item's unit cost, held by
-- Admin and Procurement; and completing, cancelling or archiving a project,
-- held by Admin (a project's own manager closes it without it).
INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'edit:unit_cost', 'edit:unit_cost'),
       (gen_random_uuid()::text, 'close:project', 'close:project')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE (r."name" = 'ADMIN' AND p."code" IN ('edit:unit_cost', 'close:project'))
   OR (r."name" = 'PROCUREMENT' AND p."code" = 'edit:unit_cost')
ON CONFLICT DO NOTHING;
