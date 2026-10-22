# Afrinov Inventory Platform: Stores and Projects Materials Roadmap

Oct 21, 2026 · Sbonakaliso Ngcobo

## Summary

Afrinov keeps two kinds of material: **Stores** material, kept on the shelf and topped up, and **Projects** material, bought for one job. Today the catalogue treats them alike: "Project Material" is just one of five categories, with Required Stock, re-ordering and issuing to any project like the rest.

This roadmap splits the catalogue into a **Stores** section and a **Projects** section. Every material belongs to one section, decided when the item is created. A Projects material belongs to **one project**, is never re-ordered, is reported apart from Stores, and is issued only to its own project. When the project closes, its leftovers move to Stores.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | A material belongs to Stores or to one project | M | Shipped (#68) |
| 2 | The Materials screens show the two sections | M | Shipped (#69) |
| 3 | Assign a project to existing Project Material | S | Shipped (#70) |
| 4 | Stores and Projects stock and reports, apart | M | Shipped (#71, follow-ups #72, #73) |
| 5 | Issue project material only to its project | S–M | Built (`feature/materials-issue-project`) |
| 6 | Order project material only for its project | S | To do |
| 7 | Move a closed project's leftovers to Stores | M | Proposed |

Sizes: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## Decisions taken (21 October 2026)

- **Allocated per item, fixed.** Stores or Projects is set on the catalogue item, not per purchase or per delivery.
- **Tied to one project.** A Projects material belongs to one named project. The same kind of item needed on two jobs is two catalogue items, for example `1369-PIPE-150NB` and `1402-PIPE-150NB`.
- **How Projects material differs:** no Required Stock and never on the re-order list, though it is still bought on a purchase order for its own project (Phase 6); its own stock view and reports; issued only to its own project.
- **A level above the categories.** Stores holds today's categories (Consumables; Fasteners, Slugs & Insulation; Tooling, PPE & Electrical; Tools). Projects takes the place of the "Project Material" category.
- **Existing Project Material:** listed for a user to assign each item to its project.
- **When a project closes** (Completed or Cancelled), its leftover stock **moves to Stores** and becomes Stores material (corrected on 21 October 2026; the first answer was "stays with the project", and Phase 4 was built on that). Nothing moves on its own: a person gives each item its Stores category, when closing the project or afterwards (an open choice in Phase 7).

## How to run this

### Order of work

One branch and pull request per phase, each on top of the one before. Phase 1 comes first: every other phase reads the new fields. Phases 4, 5 and 6 don't depend on each other once Phases 1 to 3 are in. Phase 7 comes after Phases 5 and 6, which stop a closed project's stock being issued or ordered before it moves, and its open choices are settled before it starts.

### Rule of thumb

As in the earlier roadmaps: the server enforces each rule, and the screens never offer what the server would refuse. Each pull request updates `mock/mockApi.ts` and `openapi/document.ts` for any changed endpoint.

## Phase 1: A material belongs to Stores or to one project

Size M. Backend, with a migration.

- [ ] **1.1 The project on the item.** Materials gain an optional project number, linked to Projects. The "Project Material" category becomes the **Projects** section; the other four categories make up **Stores**. Keeping the category column avoids rewriting every report that groups by it.
  Files: `prisma/schema.prisma`, a new migration
- [ ] **1.2 The rules, on the server.**
  - A Projects material needs a project (once assigned, see Phase 3). A Stores material has none.
  - A Projects material has no Required Stock. It is saved as 0 and refused if sent.
  - Moving an item between sections, or to another project, is refused once it has stock or movements, so history never changes sides. The one exception is Phase 7: a closed project's leftovers move to Stores.
  Files: `material.service.ts`, `material.routes.ts`, `stock-item.service.ts`
- [ ] **1.3 Find by section.** `GET /materials` takes `?section=STORES|PROJECTS` and `?projectNumber=`, and each material carries its section and project.
  Files: `material.routes.ts`, `openapi/document.ts`

**Done when:**
- The server refuses a new Projects material without a project, and Required Stock on one. Existing Project Material with no project is allowed until it is assigned (Phase 3).

## Phase 2: The Materials screens show the two sections

Size M. Frontend.

- [ ] **2.1 Choose the section on the item.** New item and Edit ask **Stores** or **Projects** first. Stores: pick a category and Required Stock, as today. Projects: pick the project; no Required Stock.
  Files: `components/MaterialForm.tsx`
- [ ] **2.2 Two tabs on Materials.** **Stores** and **Projects**, with the Projects tab filtered by project and grouped by project.
  Files: `pages/Materials.tsx`
- [ ] **2.3 The item page says where it belongs.** Material detail shows "Stores · Consumables" or "Project 1369 · Plant upgrade", linking to the project's materials.
  Files: `pages/MaterialDetail.tsx`
- [ ] **2.4 From a project to its materials.** On Projects, each project links to its materials on the Projects tab.
  Files: `pages/Projects.tsx`

**Done when:**
- A store controller adds a Projects item for job 1369 and finds it under Projects → 1369.

## Phase 3: Assign a project to existing Project Material

Size S. Frontend, and the workbook import.

- [ ] **3.1 "Needs a project".** Items moved to Projects without a project are listed on the Projects tab as **Needs a project**, each with a project picker, and several can be assigned at once. A notice on Materials says how many are left.
  Files: `pages/Materials.tsx`
- [ ] **3.2 Unassigned items stay safe.** Until assigned, an item keeps its stock and history, but is not issued or ordered.
  Files: `inventory.service.ts`, `procurement.service.ts`
- [ ] **3.3 The stock workbook import.** Its "Project Material Main" sheet imports into Projects as Needs a project, to be assigned the same way.
  Files: `migration/workbook-reader.ts`, `migration/mapping.ts`

**Done when:**
- Every existing Project Material item can be given its project from one list, and the list empties as they are assigned.

## Phase 4: Stores and Projects stock and reports, apart

Size M. Backend and frontend.

- [ ] **4.1 Stock by section.** The Stock page has Stores and Projects views. Projects stock is grouped by project, completed and cancelled projects included.
  Files: `pages/Stock.tsx`, `reporting.service.ts`
- [ ] **4.2 Re-ordering is for Stores.** Stock status, the re-order list (Excel and PDF) and the Dashboard's Urgent, Warning and Out of stock counts cover Stores only.
  Files: `reporting.service.ts`, `reorder-export.ts`, `pages/StockStatus.tsx`, `pages/Dashboard.tsx`
- [ ] **4.3 Value and reports split.** Stock value, the stock report and the month-end report show Stores and Projects separately, Projects by project.
  Files: `reporting.service.ts`, `report-export.ts`, `month-end-export.ts`

**Done when:**
- Project material no longer appears on the re-order list, and its value is reported per project.

## Phase 5: Issue project material only to its project

Size S–M. Backend and frontend.

- [ ] **5.1 The server refuses the wrong project.** Issuing a Projects item to another project, or to none, is refused. One issue can't hold items from two projects. Issuing to a completed or cancelled project is refused too: its leftovers go to Stores (Phase 7), and are issued from there. (Today only an inactive project is refused; marking a project Completed doesn't make it inactive.)
  Files: `inventory.service.ts`
- [ ] **5.2 Issue stock fills the project in.** Choosing a Projects item sets the issue's project and locks it; Stores items can still go to any project or none. Returns go back to the item's own project stock, and are still accepted once the project is closed: material brought back after a job is marked Completed becomes leftovers, to move to Stores (Phase 7). A return of an item already moved to Stores goes into Stores with it.
  Files: `pages/IssueStock.tsx`, `pages/ReturnStock.tsx`, `components/IssueFields.tsx`

**Done when:**
- Material for job 1369 can't be issued to anything but job 1369.

## Phase 6: Order project material only for its project

Size S. Backend and frontend.

- [ ] **6.1 The order's project matches.** A Projects item can only go on a purchase order for its own project, and one order can't hold items from two projects. Picking a Projects item on a new order sets the order's project. An order for a completed or cancelled project is refused, as its leftovers go to Stores. (Today only an inactive project is refused.)
  Files: `procurement.service.ts`, `pages/PurchaseOrderForm.tsx`
- [ ] **6.2 Order from the item.** Material detail's **Order** on a Projects item opens the form with its project set. Stock status's **Order these** stays with Stores, as Projects items are bought for their job, not topped up from the re-order list.
  Files: `pages/MaterialDetail.tsx`, `pages/StockStatus.tsx`

**Done when:**
- An order for job 1369 can't include another job's material.

## Phase 7: Move a closed project's leftovers to Stores

Size M. Backend and frontend. **Proposed**: the open choices below need settling before it's built.

- [ ] **7.1 Leftovers are flagged.** A completed or cancelled project that still holds stock shows "N items to move to Stores" on Projects, on the Stock page's Projects view and on its materials list. (Phases 5 and 6 already stop them being issued or ordered meanwhile.)
  Files: `pages/Projects.tsx`, `pages/Stock.tsx`, `reporting.service.ts`
- [ ] **7.2 Move to Stores.** One screen lists the project's leftover items, with their quantity and value. Each is given a Stores category, and all move at once. A moved item keeps its SKU, stock, locations, cost and history; it loses its project, and its Required Stock starts at 0 until someone sets it. Each move is written to the audit log, naming the project.
  Files: `material-section.ts`, `material.service.ts`, a new route, `pages/ProjectLeftovers.tsx`
- [ ] **7.3 Reports follow.** Once moved, the stock counts under Stores in stock value, stock status and reports; the project's stock is gone. The month-end note "Completed and cancelled projects keep their leftovers" is replaced by the count still to move.
  Files: `reporting.service.ts`, `pages/MonthEnd.tsx`, `month-end-export.ts`

**Open choices:**
- **Same item or a new one?** Proposed: the item itself becomes Stores, keeping its SKU and history. Alternative: its stock is moved into an existing Stores item, for when the shelf already has the same thing.
- **When?** Proposed: closing a project doesn't move anything by itself; the leftovers are flagged until someone moves them. Alternative: closing the project asks for the categories and moves them there and then.
- **Which category?** Proposed: chosen per item when moving. Alternative: one category for all of a project's leftovers.

**Done when:**
- Job 1369 is marked Completed with pipe left over; the pipe is moved to Stores under a category, and is then issued to job 1402 from Stores.

## The journeys after these phases

| Who | Journey | Phases |
|---|---|---|
| Store controller | Materials → New item → Projects → job 1369 → no Required Stock asked | 1, 2 |
| Store controller | Materials → Projects → Needs a project → assign each item → list empties | 3 |
| Store controller | Issue stock → pick a 1369 item → project fills in as 1369 and can't change | 5 |
| Buyer | Stock status → only Stores items to re-order; a 1369 item ordered from its page, on an order for 1369 | 4, 6 |
| Manager | Stock value and month-end show Stores and each project apart | 4 |
| Store controller | Job 1369 completed → Projects shows its leftovers → Move to Stores → pick categories → the items appear under Stores | 7 |

## Before each pull request

- Update `mock/mockApi.ts` for any new or changed endpoint, so `npm run dev:frontend-only` keeps working.
- Add new endpoints to `openapi/document.ts`, and keep `openapi.test.ts` green.
- Run the CI scripts: `npm run typecheck`, `lint`, `test` and `build` for the backend and frontend, and the integration tests for any backend change.
