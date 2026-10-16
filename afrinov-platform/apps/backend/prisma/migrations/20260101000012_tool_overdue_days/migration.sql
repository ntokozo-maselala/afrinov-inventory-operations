-- When a tool on loan is overdue, under Settings > Inventory. Added here so it
-- shows on the Settings page without running the seed again.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "updated_at")
VALUES ('inventory.toolOverdueDays', '7', 'number', 'inventory',
        'A tool checked out longer than this many days is overdue: flagged on the Tools page and counted on the Dashboard.',
        true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
