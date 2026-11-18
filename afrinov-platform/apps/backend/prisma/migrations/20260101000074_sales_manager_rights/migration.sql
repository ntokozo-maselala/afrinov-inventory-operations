-- The Sales Manager approves a Sales RFQ's price, the Director standing in
-- (ADR-047), and can price a job too: Sales' rights and approve:sales_rfq.
INSERT INTO "roles" ("id", "name", "description")
SELECT gen_random_uuid()::text, 'SALES_MANAGER'::"RoleName", 'SALES_MANAGER role'
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."name"::text = 'SALES_MANAGER');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."name"::text = 'SALES_MANAGER'
  AND p."code" IN ('view:sales_rfq', 'manage:sales_rfq', 'approve:sales_rfq', 'manage:projects', 'view:reports')
ON CONFLICT DO NOTHING;
