-- Housekeeping (ADR-042, system audit P6).

-- F7: signing out ends the sign-in on the server. A sign-in that began before
-- this time is refused, so a copied token stops working at once.
ALTER TABLE "users" ADD COLUMN "signed_out_before" TIMESTAMP(3);

-- F8: manage:roles was granted to Admin and checked by nothing; roles are fixed
-- in code. Its grants go with it (role_permissions cascades).
DELETE FROM "permissions" WHERE "code" = 'manage:roles';

-- D6: a draft can always be cancelled; the setting governs submitted orders.
-- Settings shows the row's description and the seed never rewrites a row.
UPDATE "settings"
SET "description" = 'Allow cancelling purchase orders once submitted, before delivery. A draft can always be cancelled.'
WHERE "key" = 'purchaseOrders.allowCancellation';
