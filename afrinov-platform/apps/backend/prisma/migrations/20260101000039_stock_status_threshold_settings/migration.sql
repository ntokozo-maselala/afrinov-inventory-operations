-- The stock status thresholds (URGENT and WARNING bands) replaced
-- inventory.lowStockMultiplier on 9 Oct 2026 without a migration, so a
-- database seeded before then has no rows for them: Settings > Inventory
-- can't show them and fails to open. Their rows, at the defaults, as other
-- settings were added. Data only: no schema change.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "enum_options", "updated_at")
VALUES
  ('inventory.urgentBelowPercent', '20', 'number', 'inventory',
   'An item is URGENT when its stock on hand is below this percentage of its Required Stock.',
   true, NULL, CURRENT_TIMESTAMP),
  ('inventory.warningBelowPercent', '40', 'number', 'inventory',
   'An item is WARNING when its stock on hand is below this percentage of its Required Stock (and not URGENT). At or above it, the item is OK.',
   true, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- The setting they replaced is no longer read.
DELETE FROM "settings" WHERE "key" = 'inventory.lowStockMultiplier';
