-- Settings that do nothing (requirements gap, 11 Nov 2026). Seven settings
-- were stored and shown but nothing read them; they are retired rather than
-- left on the page looking like controls. Their audit history stays.
-- Data only: no schema change.
DELETE FROM "settings"
WHERE "key" IN (
  'general.systemDescription',
  'general.dateFormat',
  'general.timeFormat',
  'general.defaultPageSize',
  'notifications.enableInAppNotifications',
  'notifications.enableLowStockNotifications',
  'notifications.enablePurchaseOrderNotifications'
);

-- The two kept now do what they say (ADR-035). Settings shows a setting's
-- description from its row, and the seed never rewrites a row.
UPDATE "settings"
SET "description" = 'Minutes without activity before someone is signed out. A minute before, the screen offers to keep them signed in. A sign-in also ends 12 hours after it began, however active.'
WHERE "key" = 'security.sessionTimeoutMinutes';

UPDATE "settings"
SET "description" = 'The unit a new material starts on. It can be changed on each material.'
WHERE "key" = 'inventory.defaultUnitOfMeasure';

-- The default unit was free text; it is now a unit on the list. A saved code
-- in other case or with spaces ("Each ", "KG") is kept as that unit's code;
-- anything else, an alias such as "pcs" included, starts new materials on each.
UPDATE "settings" s
SET "value" = to_jsonb(u."code")
FROM "units_of_measure" u
WHERE s."key" = 'inventory.defaultUnitOfMeasure'
  AND jsonb_typeof(s."value") = 'string'
  AND u."active"
  AND lower(btrim(s."value" #>> '{}')) = lower(u."code")
  AND s."value" #>> '{}' <> u."code";

UPDATE "settings" s
SET "value" = to_jsonb('each'::text)
WHERE s."key" = 'inventory.defaultUnitOfMeasure'
  AND NOT EXISTS (
    SELECT 1 FROM "units_of_measure" u
    WHERE u."active" AND jsonb_typeof(s."value") = 'string' AND u."code" = s."value" #>> '{}'
  );
