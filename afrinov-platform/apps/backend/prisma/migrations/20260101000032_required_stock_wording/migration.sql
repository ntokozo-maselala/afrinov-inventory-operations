-- requiredStock is called Required Stock everywhere, not a reorder threshold:
-- it is the level an item is kept topped up to, and an item is short when
-- Stock status grades it Urgent or Warning. The seed never overwrites a
-- description, so existing databases are updated here to match it.
UPDATE "settings"
SET "description" = 'Generate alerts when materials run short of their required stock (Urgent or Warning on Stock status).'
WHERE "key" = 'notifications.enableLowStockNotifications'
  AND "description" = 'Generate alerts when materials fall below their reorder threshold.';
