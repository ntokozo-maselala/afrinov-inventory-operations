-- Stores and Procurement Separation Roadmap, Phase 4. The store sees only
-- its own Stores orders (through order:stores_stock); project orders and
-- RFQs are Procurement's. The store controller no longer holds
-- view:purchase_order. Removed here so existing databases match the seed.
DELETE FROM "role_permissions"
WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "name" = 'STORE_CONTROLLER')
  AND "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" = 'view:purchase_order');
