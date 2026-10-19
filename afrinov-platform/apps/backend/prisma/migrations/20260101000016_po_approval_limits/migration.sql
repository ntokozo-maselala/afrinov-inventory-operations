-- Approval by order value, as on the AFRI-0000_x template (approver chosen
-- by order total). Each approver gets a limit in rand, including VAT; null
-- means no limit, so existing approvers keep approving as they do today
-- until an admin sets their limit.
ALTER TABLE "users" ADD COLUMN "approval_limit" DECIMAL(18,2);

-- Approvers could approve orders but not open them. Give the role the view
-- permission here, so existing databases get it without re-running the seed.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."name" = 'APPROVER' AND p."code" = 'view:purchase_order'
ON CONFLICT DO NOTHING;
