-- Stores ordering roadmap, Phase 1. Procurement buys for projects; the store
-- controller orders stock for the stores. An order without a project is a
-- Stores order, raised, submitted, cancelled and closed with this permission.
-- Added here, with the store controller's and Admin's grants, so existing
-- databases get it without re-running the seed.
INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'order:stores_stock', 'order:stores_stock')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."name" IN ('STORE_CONTROLLER', 'ADMIN') AND p."code" = 'order:stores_stock'
ON CONFLICT DO NOTHING;
