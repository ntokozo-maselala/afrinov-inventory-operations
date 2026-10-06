# Location Management

Extends the `locations` table with the master-data fields required by the
Location Management feature:

- `code` (unique, optional) — short human-friendly identifier
- `address`, `description`, `contact_person`, `contact_phone`, `contact_email`,
  `notes` — operational metadata
- `created_by_id`, `updated_by_id` — actor audit fields
- `updated_at` — required by `prisma` for `@updatedAt`

Adds indexes on `type` and `active` to support the new list filters, plus a
partial unique index on `code` so nullable codes remain valid while assigned
codes stay unique.

Backfills `code` for the three starter rows provisioned by `db:seed`.

## New permission codes
- `edit:location` — edit an existing location
- `delete:location` — remove a location that has no dependencies
- `manage:location_status` — activate / deactivate a location

Granted to `ADMIN` (all) and `STORE_CONTROLLER` (edit/delete/status).
