-- Where project deliveries are booked on Receive stock (Project Material
-- Through the Store Roadmap, Phase 4). Project material isn't shelved: the
-- storeman receives it and issues it to the workshop straight away, so one
-- location, such as the workshop floor, takes every project delivery.
-- Blank until an administrator chooses one; Receive stock then asks for a
-- location on each line, as before. Data only: no schema change.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "enum_options", "updated_at")
VALUES
  ('inventory.projectReceivingLocationId', '""', 'string', 'inventory',
   'Where project deliveries are booked on Receive stock, such as the workshop floor: project material is not shelved, it is issued from there. Leave blank to choose a location on each delivery.',
   true, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
