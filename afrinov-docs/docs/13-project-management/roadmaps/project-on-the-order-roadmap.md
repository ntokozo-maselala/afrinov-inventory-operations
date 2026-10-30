# Afrinov Inventory Platform: Project on the Order Roadmap

Oct 30, 2026 · Sbonakaliso Ngcobo

## Summary

Four phases that move a project from the **catalogue item** to the **order**. Today each Projects item belongs to one project (`materials.project_number`), and ordering refuses an item with no project or another project's item. That made sense while project material came into the store and the store had to know whose stock was on the shelf. Since the [Stores and Procurement Separation Roadmap](stores-procurement-separation-roadmap.md), project material goes from the supplier straight to site and is never stock, so the project is already known where it matters: on the purchase order, its RFQ, and its delivery confirmation.

After this roadmap a Projects item is a plain catalogue entry ("10mm Plate"), any project order can use it, and the order says which project it is for. The "Needs a project" step, its banners and the "No project yet" warnings go. Leftovers received before the separation keep the project they have, so they are still issued to their own project or moved to Stores.

It amends the [Materials Sections Roadmap](materials-sections-roadmap.md), Phases 5 and 6, which put the project on the item.

**Status:** Phase 1 merged as #129; Phase 2 on `feature/project-on-the-order-2`. Phases 3 and 4 not started.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | The server takes the project from the order | M | Built (#129) |
| 2 | Ordering screens: any Projects item on any project order | M | Built |
| 3 | Catalogue screens: no project on the item | M | Proposed |
| 4 | Docs and ADR | S | Proposed |

Sizes: **S** is about a day, **M** is 2 to 4 days.

## How to run this

### Before and after

| | Today | After |
|---|---|---|
| Where the project lives | On the Projects item, and on the order | On the order (and its RFQ and delivery confirmation) |
| A catalogue entry | One per project: `PROJ-AFRI-1325-PLATE`, `PROJ-AFRI-1402-PLATE` | One per material: `PLATE-10MM`, used by any project |
| Ordering an item with no project | Refused: "has no project yet… Give it its project on Materials first" | Allowed: the order's project applies |
| Ordering another project's item | Refused | Allowed: the item belongs to no project |
| A project order holding Stores items | Refused | Refused, as now: the store orders Stores stock |
| "Needs a project" panel and banners | On Materials (both tabs) | Gone |
| What a project has ordered and received | Read from the items tagged with it | Read from its orders and their delivery confirmations |
| Leftovers from before the separation | Issued to their project; a closed project's moved to Stores; an item with no project can't be issued until given one | Issued to their project; a closed project's, or an item with no project, moved to Stores |

### Decisions

| Decision | Choice | Decided |
|---|---|---|
| Where a project is recorded for project material | On the order (and RFQ, delivery confirmation), not on the catalogue item | 30 Oct 2026 |
| An item's existing project | Kept in the database, and still governs leftovers (issue to that project, Move to Stores when it closes). It no longer affects ordering or RFQs | Proposed |
| A project order's contents | Projects items only, as now; any of them, whatever project they were tagged with | Proposed |
| Leftovers on an item with **no** project | **Move to Stores only**: they are not issued (as today), and since no one gives items a project any more, Project leftovers moves them to Stores like a closed project's. (Not chosen: issuing them to any project) | 30 Oct 2026 |
| Who sees a project's orders from the Projects page | Those who see project orders (Procurement, approvers, Admin): the page's Materials link becomes **Orders** (`/purchase-orders?project=`) | Proposed |
| Renaming or merging per-project duplicates (`PROJ-AFRI-1325-PLATE` → `PLATE-10MM`) | Not in this roadmap: optional clean-up afterwards, done by Admin | Proposed |
| Migration | None: `materials.project_number` stays (nullable) for leftovers | Proposed |

### Order of work

#125 and #126 have merged, so each phase branches from `main`. One branch and pull request per phase. Phase 1 only relaxes server rules, so it can merge on its own: today's screens keep offering only items of the order's project until Phase 2 widens them. Phases 2 and 3 should reach the business together, since Phase 3 removes the step Phase 2 makes unnecessary.

## Phase 1: The server takes the project from the order

Size M. Backend and mock.

- [x] **1.1 Ordering ignores the item's project.** Creating, editing and submitting a purchase order no longer call `refuseUnassigned` or `checkProjectMaterial` for ordering (`procurement.service.ts`). A project order still needs its own project, and still refuses Stores items (`refuseStoresOnProjectOrder`).
- [x] **1.2 RFQs ignore the item's project.** `rfq.service.ts` drops `refuseUnassigned`; an RFQ's project stays on the RFQ and passes to the order it is awarded as.
- [x] **1.3 Issuing leftovers is unchanged.** `inventory.service.ts` keeps `checkProjectMaterial` and `refuseUnassigned` for issues: an item tagged with a project is issued to that project only, and one with no project isn't issued. `refuseUnassigned`'s message stops saying "Give it its project on Materials first" and says to move it to Stores.
- [x] **1.4 Moving leftovers with no project to Stores.** Project leftovers lists and moves a "no project" group too (`project-leftovers.service.ts`, `GET/POST /projects/none/leftovers` or a separate route), as it does a closed project's: each item gets a Stores category and becomes a Stores item, keeping its SKU, stock, locations, cost and history.
- [x] **1.5 Mock and API docs.** `mock/mockApi.ts` mirrors 1.1 to 1.4; `openapi/document.ts` drops "the item must belong to the order's project" from purchase orders and RFQs, and documents the "no project" leftovers.

**Tests:** a project order (and an RFQ) taking an item with no project and an item tagged with another project, over real HTTP; a project order still refusing a Stores item; an issue still refusing another project's leftovers and an item with no project; moving an item with no project and stock to Stores.

- [x] **1.6 Added during review (#129).** A Stores order holds Stores items only, checked on create and submit: the item-project check used to keep project material off it. Moving to Stores is refused while an item is on an open project order or RFQ, and is locked against raising an order for it at the same moment. The screen part of 3.5 came forward: Project leftovers has a "no project" view (`/materials/no-project/leftovers`), and the Stock notice and an item's **Left in the store** link to it.

**Done when:** the server accepts any Projects item on any project order or RFQ.

## Phase 2: Ordering screens: any Projects item on any project order

Size M. Frontend.

- [x] **2.1 New and edit purchase order.** The line picker offers every active Projects item once a project is chosen, not only that project's (`PurchaseOrderForm.tsx`). The New item drawer creates a Projects item with no project.
- [x] **2.2 New RFQ.** The same for RFQ lines (`RfqForm.tsx`).
- [x] **2.3 Order from an item's page.** **Order** shows for any active Projects item, whatever project it is tagged with, closed or not: the project is chosen on the order (`MaterialDetail.tsx`).
- [x] **2.4 Documents.** The purchase order and RFQ PDFs already take the project from the order; checked, not changed (`poDocument.ts`, `rfqDocument.ts`).

- [x] **2.5 Added in Phase 2.** Adding a Projects item no longer needs a project (`projectForNewMaterial`); one created with opening stock (`POST /stock-items`) still does, as stock with no project can't be issued. Choosing an item tagged with an open project suggests the order's or RFQ's project while none is chosen, without fixing it; the edit page's project lock is gone too.

**Done when:** Procurement can order or request quotes for any Projects item for any open project.

## Phase 3: Catalogue screens: no project on the item

Size M. Frontend.

- [ ] **3.1 The item form.** A new Projects item has no Project field (`MaterialForm.tsx`). Editing an existing item leaves its project as it is and doesn't offer to change it.
- [ ] **3.2 Materials.** The "Needs a project" panel (`NeedsProjectPanel.tsx`) and the Stores tab's "N Projects items need a project" banner go. The Projects tab lists items without a Project column or Project filter; its leftovers notice stays.
- [ ] **3.3 A Projects item's page.** Its Identity card drops Project and "No project yet". Its **Left in the store** section, shown only while leftovers exist, names the project they belong to when the item has one.
- [ ] **3.4 Projects page.** Each project's **Materials** link becomes **Orders**, opening Procurement's purchase orders for that project (`/purchase-orders?project=`), for those who see project orders.
- [ ] **3.5 Leftovers with no project.** Wherever they are flagged, they lead to Project leftovers to be moved to Stores, not to "Give them their projects": the Stock page's project notice (`ProjectStockNotice`), the item's **Left in the store** (Move to Stores), and the Project leftovers page itself, which shows the "no project" group like a closed project's.
- [ ] **3.6 Older links.** `/materials?section=PROJECTS&project=…` opens the Projects tab without a filter.

**Done when:** nothing asks for, or warns about, a project on a catalogue item.

## Phase 4: Docs and ADR

Size S.

- [ ] **4.1 ADR-023** records that a project lives on the order, amending the Materials Sections decisions behind Phases 5 and 6, and ADR-022's leftovers.
- [ ] **4.2** Business rules, the purchase order lifecycle, the RFQ process, the page inventory, the glossary (Projects material), the change log, and this roadmap's status.

## After this roadmap (not in scope)

- **Ordered and delivered per project:** on the Projects page, what each project has on order and what has been confirmed delivered to site, from its orders, for example "Ordered 40 m on AFRI-0412, 25 m delivered".
- **Duplicate clean-up:** merge per-project copies of one material into a single catalogue entry, keeping history.

## Before each pull request

- From `afrinov-platform/`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:integration --workspace=@afrinov/backend`.
- Update `mock/mockApi.ts` and `openapi/document.ts` for any changed rule.
