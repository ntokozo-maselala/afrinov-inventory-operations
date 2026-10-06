# Initial schema baseline

This migration creates the full Afrinov Platform schema: every model,
enum, index, and foreign key defined in `prisma/schema.prisma`. It
serves as the baseline for all subsequent migrations.

The follow-up `20260101000000_location_management` migration extends
the `locations` table with master-data fields (code, address, contact
information, notes) used by the Location Management feature.

Run order:

1. `20260101000000_initial` — creates all tables.
2. `20260101000000_location_management` — extends `locations`.

Both migrations are non-destructive and additive. The only UPDATE in
`location_management` is a conditional backfill of the new `code`
column for known seed rows.
