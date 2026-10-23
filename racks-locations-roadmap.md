# Afrinov Inventory Platform: Racks and Locations Roadmap

Oct 22, 2026 · Sbonakaliso Ngcobo

## Summary

In the stock workbook, Rack and Location are one field. Each item has one place, written in a column called "Location" on the item lists and copied by formula into the "Rack" columns of the Stock Report and Issued sheets. That place is either a rack-and-shelf code (`A-1`, `D-1`, `F-4`) or a room or area (`Stores`, `Upstairs`, `Machine Shop`).

The platform holds stock the same way, per item per **Location**, and the import turns the workbook's places into Locations. But it also has a separate **Rack** record, on its own Racks page, that holds no stock and is not linked to the Location of the same name. A rack has to be entered twice, the import never creates Rack records, and nothing can say which room a rack-type location is in.

This roadmap makes it one record: a rack is a Location of type Rack, with an optional **parent location**, the room it stands in. The separate Rack record and Racks page are retired.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | A location can sit inside another | S–M | Done (#85) |
| 2 | Show and choose the parent on screen | S–M | Done (#86) |
| 3 | Move the Rack records onto locations, retire Racks | M | 3.1 done (#87); 3.2 done (#88); 3.3 done (#90) |
| 4 | The import asks which room each rack is in | S | In review |
| 5 | Stock by room, racks included | S–M | Done (#91) |

Sizes: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## How to run this

### Decisions needed

- **Depth:** *Decided: one level* (a rack inside a room), as built in Phase 1. It is all the workbook needs, and reports stay simple.
- **Rack extras:** *Decided 2026-10-22: drop them.* A Rack record also has a capacity, a "Full" status, a project and notes. None of them comes from the workbook and nothing uses them. The 3.1 report lists every one, and each rack's full record goes to the audit log before it is removed.
- **Which room:** the storeman says which room each rack is in (racks A to O are presumably in the Stores room). Needed before Phase 4.

### Order of work

One branch and pull request per phase, in order. Phase 3 needs Phases 1 and 2. Phases 4 and 5 can go in either order after Phase 1.

## Phase 1: A location can sit inside another

Size S–M. Backend.

- [x] **1.1 Parent location.** A nullable `parentId` on `Location`, pointing at another location, in a new migration. One level: a location with a parent cannot itself be a parent, and the parent must be active and not of type Rack.
  Files: `prisma/schema.prisma`, new migration, `modules/inventory/location.service.ts`
- [x] **1.2 API.** `POST` and `PATCH /locations` take `parentId`; `GET /locations` returns each location's parent. A location with locations inside it cannot be deleted or deactivated until they are moved.
  Files: `location.service.ts`, `material.routes.ts` (location routes), `openapi/document.ts`, `mock/mockApi.ts`

**Done when:** `D-1` can be saved as a Rack inside `Main Storeroom`, and the API refuses a loop or a second level.

## Phase 2: Show and choose the parent on screen

Size S–M. Frontend.

- [x] **2.1 Locations page.** A "Located in" field on the location form, a column in the list, and a filter by room.
  Files: `pages/Locations.tsx`
- [x] **2.2 Pickers say where a rack is.** Wherever a location is chosen (Receive, Issue, Return and Count stock, transfers, tool check-out), a rack shows as `D-1 · Main Storeroom`.
  Files: the location pickers on those pages

**Done when:** a storeman picking a rack sees which room it is in.

## Phase 3: Move the Rack records onto locations, retire Racks

Size M. Backend and frontend. Needs Phases 1 and 2.

Three pull requests, each safe on its own. Nothing is deleted until the copy has run on every database, and the delete refuses to run if it has not.

- [x] **3.1 Copy what Rack records know, with a dry run.** *Done (#87), and run on the local database: D-1 into Main Storeroom, F-7 created there, CHK-8849 discarded; 0 racks left.* A command (`npm run racks:to-locations`), a dry run by default like the vendor list import, that writes a report and changes nothing.
  - **Matching, never a guess.** Each Rack is matched to a location by code first. A name match counts only when exactly one location has that name and the rack's code points to no other location. Anything else (the code and the name point to different locations, or several could fit) is reported as *needs a decision*, and that rack is neither changed nor removed.
  - **The report** lists every rack under one heading: will set the room (from the Rack's location, through the Phase 1 rules, so never inside a rack or an inactive room), already in that room, conflict (the location is already in a different room), needs a decision, no matching location, and the extras that would be dropped (project, capacity, "Full" status, notes).
  - **Settling what it cannot.** The command is the supported way to resolve a rack the match leaves open, and stays so until 3.3, since the Racks page goes in 3.2: `--create <code>` adds the rack as a location of type Rack in its room, and `--discard <code>` removes it. Each takes the rack codes it names, so nothing is created or removed without a person choosing it.
  - **Before `--apply`:** back up the database (`pg_dump`) and keep the dry-run report, since applying removes Rack rows. Then `--apply`, with the database name typed back and the acting user, applies everything in one transaction and is safe to run again.
  - **Nothing about a rack is lost.** Before removing a Rack, it writes the rack's full record (code, name, location, project, capacity, status, notes) to the audit log, then removes each Rack it copied or that someone discarded. Racks still needing a decision stay, listed in the report.
  Files: `scripts/racks-to-locations.ts` (new), `package.json`
- [x] **3.2 Retire the Racks page, keeping the table and its guards.** *Done (#88). The seed no longer creates demo racks (it would refill the table 3.3 needs empty); it puts the demo location D-1 in Main Storeroom instead.* Remove the Racks menu entry and page; `/racks` redirects to Locations filtered to type Rack. Remove the `/racks` routes and the `manage:racks` permission from the roles. The Movements "Other changes" history names rack entries from the audit log itself (the rack's own entries that carry its code and name, such as when it was added or the record 3.1 wrote), not from the Rack table: today an "Archived rack" entry records only its status and takes the name from the table, so it would read "a rack" once the table is gone. Rack entries link to Locations. Update the Locations page's description, which currently explains the two records. **Keep the rack count in the location delete check:** while any Rack row remains, deleting its location would quietly clear the rack's location (`ON DELETE SET NULL` on `racks.location_id`) before 3.1 has copied it.
  Files: `pages/Racks.tsx`, `App.tsx`, `hooks/useNavGroups.tsx`, `modules/inventory/rack.routes.ts`, `rack.service.ts`, `modules/audit/activity.service.ts`, `shared/permissions.ts`, `pages/Locations.tsx`, `db/seed.ts`, `mock/*`, `openapi/document.ts`
- [x] **3.3 Drop the Rack table**, *Done (#90): migration `20260101000022_drop_racks`, tested on a throwaway Postgres (drops on an empty table, refuses with a rack left); the `racks:to-locations` command goes with the table,* in a later migration once 3.1 has run on every database and every rack is settled. The migration first checks that `racks` is empty and **stops with an error** if it is not, so it cannot drop a Rack that was never copied. It drops the `RackStatus` type and deletes the `manage:racks` permission; only now does the location delete check stop counting racks. Update `src/db/migrations.test.ts`, which lists the Rack table and its keys. Back up the database (`pg_dump`) before deploying it.
  Files: new migration, `prisma/schema.prisma`, `location.service.ts`, `src/db/migrations.test.ts`

On the local database the 3.1 dry run gives: rack `D-1` goes inside Main Storeroom (dropping project AFRI-1325, capacity 100 and its description); `F-7` has no matching location and `CHK-8849` looks like test data, so both need a decision (`--create F-7`, `--discard CHK-8849`).

**Done when:** each rack exists once, as a location, and nothing in the app mentions a separate Rack.

## Phase 4: The import asks which room each rack is in

Size S. Backend. Needs Phase 1 and the "which room" decision.

- [x] **4.1 A "Located in" column in the location mapping file**, filled in for codes like `D-1` with the room the storeman named, and checked on import like the other columns. *Built.* The dry run checks it by the Locations page's rules (one level, never inside a rack or itself, one room per place); a room not on the sheet is created as a storeroom; a rack left without a room is listed for review, not blocking. The apply step creates rooms first and puts each location in its room under the location-tree lock, reusing the same parent checks; it refuses to move a location that is already in another room. The room list itself is the storeman's to fill in before go-live.
  Files: `modules/migration/mapping.ts`, the import's apply step

**Done when:** after the import, every rack-type location has its room.

## Phase 5: Stock by room, racks included

Size S–M. Backend and frontend. Needs Phase 1.

- [x] **5.1 Filter by room.** *Built.* The Stock page and the movement reports can be filtered by a room, covering stock on its racks too. The Stock page has a Room filter and names a rack with its room (`D-1 · Main Storeroom`). On Movements, a room is offered as "Main Storeroom and its racks", which sends `inside=true` with `locationId`; the movement reports, deliveries and counts all take it. A plain `locationId` stays exactly that one location, as Count stock relies on.
  Files: `pages/Stock.tsx`, `pages/Movements.tsx`, the matching report queries
- [x] **5.2 Dashboard by room.** *Built.* The Dashboard's stock-by-location chart can group racks under their room: a "By location / By room" switch, shown once a location stands in a room.
  Files: `pages/DashboardCharts.tsx`
- [x] **5.3 Exports keep the workbook's "Rack" column** as the location the stock is on (`D-1`), as today. *No change needed.*

**Done when:** "what is in the Main Storeroom?" counts the stock on its racks.

## Before each pull request

- Update `mock/mockApi.ts` for any new or changed endpoint, so `npm run dev:frontend-only` keeps working.
- From `afrinov-platform/`, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`; for backend changes, also `npm run test:integration`.
- Update the docs that describe locations and racks (`03-domain/entity-catalog.md`, `09-frontend/page-inventory.md`) and this roadmap's status.

Based on a review of `AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm` and the location, rack and import code on `main`, 22 October 2026. File references are relative to `afrinov-platform/apps/`.
