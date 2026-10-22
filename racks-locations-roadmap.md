# Afrinov Inventory Platform: Racks and Locations Roadmap

Oct 22, 2026 · Sbonakaliso Ngcobo

## Summary

In the stock workbook, Rack and Location are one field. Each item has one place, written in a column called "Location" on the item lists and copied by formula into the "Rack" columns of the Stock Report and Issued sheets. That place is either a rack-and-shelf code (`A-1`, `D-1`, `F-4`) or a room or area (`Stores`, `Upstairs`, `Machine Shop`).

The platform holds stock the same way, per item per **Location**, and the import turns the workbook's places into Locations. But it also has a separate **Rack** record, on its own Racks page, that holds no stock and is not linked to the Location of the same name. A rack has to be entered twice, the import never creates Rack records, and nothing can say which room a rack-type location is in.

This roadmap makes it one record: a rack is a Location of type Rack, with an optional **parent location**, the room it stands in. The separate Rack record and Racks page are retired.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | A location can sit inside another | S–M | In review (#85) |
| 2 | Show and choose the parent on screen | S–M | In review (#86) |
| 3 | Move the Rack records onto locations, retire Racks | M | Not started |
| 4 | The import asks which room each rack is in | S | Not started |
| 5 | Stock by room, racks included | S–M | Not started |

Sizes: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## How to run this

### Decisions needed

- **Depth:** *Decided: one level* (a rack inside a room), as built in Phase 1. It is all the workbook needs, and reports stay simple.
- **Rack extras:** a Rack record also has a capacity, a "Full" status and a project. None of them comes from the workbook and nothing uses them. Drop them, or move them onto the location? *Recommended: drop them.*
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

- [ ] **3.1 Copy what Rack records know.** A migration matches each Rack to the location with the same code or name and sets that location's parent from the Rack's location. Racks with no matching location are listed in a report, for someone to add or discard. Nothing is deleted yet.
  Files: new migration or a one-off script under `scripts/`
- [ ] **3.2 Retire the Racks page.** Remove the Racks menu entry and page; `/racks` redirects to Locations filtered to type Rack. Remove the `/racks` routes and the rack count from the location delete check. Update the Locations page's description, which currently explains the two records.
  Files: `pages/Racks.tsx`, `App.tsx`, `hooks/useNavGroups.tsx`, `modules/inventory/rack.routes.ts`, `rack.service.ts`, `location.service.ts`, `pages/Locations.tsx`, `db/seed.ts`, `mock/*`
- [ ] **3.3 Drop the Rack table**, in a later migration once 3.1 has run on every database.

**Done when:** each rack exists once, as a location, and nothing in the app mentions a separate Rack.

## Phase 4: The import asks which room each rack is in

Size S. Backend. Needs Phase 1 and the "which room" decision.

- [ ] **4.1 A "Located in" column in the location mapping file**, filled in for codes like `D-1` with the room the storeman named, and checked on import like the other columns.
  Files: `modules/migration/mapping.ts`, the import's apply step

**Done when:** after the import, every rack-type location has its room.

## Phase 5: Stock by room, racks included

Size S–M. Backend and frontend. Needs Phase 1.

- [ ] **5.1 Filter by room.** The Stock page and the movement reports can be filtered by a room, covering stock on its racks too.
  Files: `pages/Stock.tsx`, `pages/Movements.tsx`, the matching report queries
- [ ] **5.2 Dashboard by room.** The Dashboard's stock-by-location chart can group racks under their room.
  Files: `pages/DashboardCharts.tsx`
- [ ] **5.3 Exports keep the workbook's "Rack" column** as the location the stock is on (`D-1`), as today.

**Done when:** "what is in the Main Storeroom?" counts the stock on its racks.

## Before each pull request

- Update `mock/mockApi.ts` for any new or changed endpoint, so `npm run dev:frontend-only` keeps working.
- From `afrinov-platform/`, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`; for backend changes, also `npm run test:integration`.
- Update the docs that describe locations and racks (`03-domain/entity-catalog.md`, `09-frontend/page-inventory.md`) and this roadmap's status.

Based on a review of `AFRI-03A-08-IAM-02 - Stock Inventory1.xlsm` and the location, rack and import code on `main`, 22 October 2026. File references are relative to `afrinov-platform/apps/`.
