# Afrinov Inventory Platform: Project Material Through the Store Roadmap

Nov 2, 2026 · Sbonakaliso Ngcobo

## Summary

Five phases that bring project material back into the store. The [Stores and Procurement Separation Roadmap](stores-procurement-separation-roadmap.md) decided that project material goes from the supplier straight to site, so a project order is never received into stock: Procurement confirms its delivery on the order and no stock is added (ADR-021, Phase 3). That is not how the store works. On 2 Nov 2026 the business confirmed:

- **All** project material comes through the store.
- The **storeman** books its delivery, not Procurement.
- The same catalogue item **can** be bought for two projects at once.

The third answer decides the design. Since the [Project on the Order Roadmap](project-on-the-order-roadmap.md) (ADR-023), the project lives on the order, not the item, and any Projects item can go on any project order. So the item can't say whose stock is on the shelf: 10 m of `10mm Plate` for AFRI-1325 and 6 m for P-42 are the same item at the same location. **Stock has to carry its project.** After this roadmap every stock movement and balance says which project the stock is *held for* (none for Stores stock), the storeman receives project orders on Receive stock, and Issue stock issues each project's own stock to it.

It amends ADR-021 (straight to site; Procurement confirms delivery) and ADR-023 (only leftovers carry a project, on the item). Recorded as ADR-025 in Phase 5.

**Status:** Phase 1 built on `feature/project-stock-1` (PR #142) and Phase 2 on `feature/project-stock-2` (PR #143), neither merged yet. Phases 3 to 5 proposed.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | Stock is held for a project | L | Built |
| 2 | The storeman receives project orders | M | Built |
| 3 | Issue, return, count and move by project | M | Proposed |
| 4 | Stock, project and report screens | M | Proposed |
| 5 | Closing a project, docs and ADR | S–M | Proposed |

Sizes: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## How to run this

### Before and after

| | Today | After |
|---|---|---|
| Project delivery | Straight to site; Procurement confirms it on the order; no stock | To the store; the storeman books it on Receive stock; stock is added, held for the order's project |
| What a balance is | Item × location | Item × location × project held for (none for Stores stock) |
| Whose stock it is | Stores, except leftovers, which take the item's project (`materials.project_number`) | The movement says: each receipt records the project it is held for |
| Issue stock with a project | That project's leftovers only (PR #140) | That project's stock, from its own deliveries |
| Stock page | Stores only, with leftovers listed above | Stores and Projects, by project |
| Closing a project | Its items are flagged as leftovers, and Move to Stores turns the item into Stores | Its remaining stock is flagged, and Move to Stores moves the stock, not the item |

### Two meanings of "project" on a movement

`inventory_transactions.project_number` already exists (FR-REP-004). It records **who the stock was used for**: a Stores item issued to AFRI-1325 carries it, though it comes out of Stores stock. That stays as it is, as consumption reports depend on it.

The new field records **whose stock it is**: `held_for_project`. A Stores issue to AFRI-1325 has `project_number = AFRI-1325` and `held_for_project = null`; an issue of AFRI-1325's own plate has both. Keeping them apart means consumption keeps working and no history is rewritten.

### Decisions

| Decision | Choice | Decided |
|---|---|---|
| Where project material is delivered | To the store, all of it | 2 Nov 2026 |
| Who books a project delivery | The storeman, on Receive stock | 2 Nov 2026 |
| One item on two projects | Allowed, so stock carries its project (not the item) | 2 Nov 2026 |
| Confirm delivery on a project order | Retired: a project order is received into stock like a Stores order | 2 Nov 2026 |
| Project orders already confirmed as delivered to site | Left as history: nobody counted that material into the store, so nothing is back-filled. The order still reads "Delivered to site" | Built so in Phase 2 |
| Who receives project orders | The store controller (and Admin), through a receiving-only view of the order: its supplier, project, lines and what each owes, not its prices, approval or RFQ | 2 Nov 2026 |
| Issuing one project's stock to another | Refused. Moving stock between projects is left out of this roadmap; a closed project's stock still goes to Stores | Proposed |
| Leftovers from before | Keep their project on the item until Phase 3, when issuing starts reading the stock's project; Phase 3 then gives their stock the item's project. Phase 1 back-fills nothing (see Phase 1) | 2 Nov 2026 |

### Order of work

One branch and pull request per phase, in order. Phase 1 changes no behaviour on screen (all stock stays Stores stock, as today), so it can merge and deploy on its own and be checked against live data first. Phases 2 and 3 change what the storeman does and should reach the business together.

## Phase 1: Stock is held for a project

Size L. Backend and migration. The risky phase: it changes how balances are keyed on live stock data. Read `docs/engineering/README.md` (database assurance) before starting.

*Built on `feature/project-stock-1` (migration `20260101000035_stock_held_for_project`).* One change from the plan: **nothing is back-filled.** Giving today's leftovers their item's project in the migration would have meant every movement working out whose stock it is from the item, a stopgap Phase 3 replaces, plus a stock move when leftovers go to Stores. So every existing movement stays Stores stock, and leftovers keep their project on the item until Phase 3.

- [x] **1.1 The ledger records whose stock it is.** A nullable `held_for_project` on `inventory_transactions`, referencing `projects` with `ON DELETE RESTRICT ON UPDATE RESTRICT`, so a project holding stock can't be deleted or renumbered under its balances. Separate from `project_number` (who the stock was used for).
  Files: `prisma/schema.prisma`, new migration
- [x] **1.2 Balances are per project.** `inventory_balances` gains `held_for_project`, `''` for Stores stock (not null, so it can be part of the key and Prisma can address the row), and its primary key becomes (material, location, held for). Every existing balance becomes `''` with the same quantity, so nothing is rebuilt.
  Files: new migration, `src/db/migrations.test.ts`
- [x] **1.3 Every write names the stock it touches.** `lockInventoryBalances`, `recomputeBalance` and `getCurrentBalance` take a key whose project is required (`storesStock()` for Stores). Returns and reversals go back to the stock they came from; everything else posts Stores stock until Phases 2 and 3. `stock-item.service.ts` uses the shared recompute instead of its own copy.
  Files: `shared/inventory/balances.ts`, `modules/inventory/balances.ts`, `inventory.service.ts`, `stock-receipt.service.ts`, `stock-count.service.ts`, `tool-loan.service.ts`, `stock-item.service.ts`, `procurement/procurement.service.ts`, `migration/opening-balance.service.ts`, `db/seed.ts`, `integration/helpers.ts`
- [x] **1.4 Reports read the same totals.** Current stock says whose stock each row is (`heldForProject`); reports that sum an item read every row, so totals are unchanged.
  Files: `reporting/reporting.service.ts`, `openapi/document.ts`, `frontend/src/api/types.ts`

Tests: unit tests for the balance key and for returns and reversals keeping the project, a migration test, and the existing suites unchanged (backend 951 unit, 195 integration). The migration was also run on a database holding stock in the old format: every balance kept its quantity as Stores stock, a second balance held for a project was accepted, and deleting a project holding stock was refused.

**Done when:** the migration runs on a copy of live data with every total unchanged, and nothing on screen looks different.

## Phase 2: The storeman receives project orders

Size M. Backend and frontend. Needs Phase 1, and the decision on who receives project orders.

*Built on `feature/project-stock-2` (PR #143), with no migration.* Two changes from the plan: the store controller needed no new permission, as `receive:purchase_order` (store controller and Admin) already says who receives orders; and Qodo's remaining findings on PR #142, which only became real once project stock existed, were fixed first, as step 2.0.

- [x] **2.0 Stores-only views stay Stores-only.** Move to Stores refuses an item with stock held for a project; Project leftovers, the tool list, stock status, re-order and stock alerts count Stores stock only; the inventory report and its exports name the project a line is held for ("A-1 · held for AFRI-1325"); movement history returns `heldForProject`.
  Files: `project-leftovers.service.ts`, `reporting.service.ts`, `report.service.ts`, `report-export.ts`, `tool-loan.service.ts`, `inventory.service.ts`

- [x] **2.1 The server receives project orders into stock.** The three `PROJECT_DELIVERY_REFUSED` refusals go: receive (`procurement.service.ts`), goods receipts (`goods-receipt.service.ts`) and stock receipts (`inventory.service.ts`). A receipt against a project order posts stock held for the order's project.
  Files: `procurement.service.ts`, `goods-receipt.service.ts`, `inventory.service.ts`
- [x] **2.2 The store controller may receive one.** A receiving view, `GET /purchase-orders/receivable`, lists the Approved and Partly received orders of the kinds the user receives: supplier, project, lines and what each owes, with no prices, approval or RFQ. Receiving a project order and reading its receipts need `receive:purchase_order`; the order itself stays Procurement's (*not found* to the store), and a buyer who can see it but not receive it is refused (403), not told it is missing.
  Files: `procurement.routes.ts`, `procurement.service.ts`, `openapi/document.ts`
- [x] **2.3 Receive stock lists project orders.** The Order list, from the receiving view, shows project orders beside Stores orders, labelled with their project ("AFRI-0430 · for AFRI-1325 · Plant upgrade"); the form shows "Held for project AFRI-1325". The confirmation says the stock is held for the project and leaves closing the order to Procurement.
  Files: `pages/ReceiveStock.tsx`, `mock/mockApi.ts`
- [x] **2.4 Confirm delivery is retired.** The order page no longer offers it; `POST /purchase-orders/:id/confirm-delivery` refuses with a message pointing to Receive stock. Orders already confirmed keep their history, and an order finished that way still reads "Delivered to site".
  Files: `procurement.service.ts`, `procurement.routes.ts`, `pages/PurchaseOrderDetail.tsx`, `openapi/document.ts`

Also built in review on PR #143, so that stock held for a project is counted as that project's wherever stock is added up:

- **Reports.** Month-end lists project stock a line per item and project, with no Required Stock or status; Stores figures count Stores stock only. The inventory report's project totals credit the project stock is held for, not the item's. The Dashboard's stock value includes held stock under its project, and the "Leftovers to move to Stores" notice counts only leftovers, which Move to Stores can take.
- **Screens.** A Projects item's page lists "In the store for projects" apart from leftovers, and offers Issue only for Stores stock. The Stock page lists what is held for each project, each item linking to its page, until Phase 4 gives project stock its own views.
  Files: `month-end.service.ts`, `month-end-export.ts`, `report.service.ts`, `reporting.service.ts`, `pages/MaterialDetail.tsx`, `pages/MonthEnd.tsx`, `pages/Dashboard.tsx`, `pages/PurchaseOrderDetail.tsx`, `components/LeftoversNotice.tsx`, the mock reports

Tests: `procurement.real-http.test.ts` (a project order received in part and then in full, by goods receipt and by Receive; the stock is held for its project and Stores stock is untouched; the receiving view has no prices; the buyer is refused; Confirm delivery refuses), `PoProjectDelivery.test.tsx` (replacing `PoConfirmDelivery.test.tsx`), `PoReceiveDelivery.test.tsx`, `PoApproval.test.tsx`, `mockDelivery.test.ts`, and the report, month-end, item and Stock page suites. Backend 958 unit and 194 integration tests, frontend 1,109.

**Done when:** the storeman books a delivery against AFRI-1325's order, and the stock shows as AFRI-1325's.

## Phase 3: Issue, return, count and move by project

Size M. Backend and frontend. Needs Phase 1.

- [ ] **3.0 Leftovers' stock takes their project.** A migration gives the movements of each Projects item that has `materials.project_number` that project as `held_for_project`, and rebuilds those balances, **stopping with an error** if any item × location total changes. Left out of Phase 1 so that until issuing reads the stock's project, leftovers keep working from the item.
  Files: new migration, `src/db/migrations.test.ts`
- [ ] **3.1 Issue stock takes from the project's own stock.** With a project chosen, the item list is that project's stock (as PR #140 already filters, now from `held_for_project` instead of the item); with none, Stores stock only. The server deducts from the stock held for the issue's project and refuses another project's stock. A Stores item can still be issued to a project, from Stores stock, as today.
  Files: `pages/IssueStock.tsx`, `inventory.service.ts`, `material-section.ts` (`checkProjectMaterial` reads the stock, not the item)
- [ ] **3.2 A return goes back to the stock it came from.** Returning an issued line puts it back held for the same project; a reversal does the same.
  Files: `inventory.service.ts` (`returnToStock`, `returnMany`, `returnable`, `reverse`), `pages/ReturnStock.tsx`
- [ ] **3.3 Counts and transfers keep the project.** A stock count lists one line per item × location × project, and a variance adjusts that stock. A transfer between locations moves stock without changing its project.
  Files: `stock-count.service.ts`, `pages/StockCount.tsx`, `inventory.service.ts` (`transfer`, `adjust`)

Tests: `inventory.service.test.ts`, `consumption.real-http.test.ts`, `returns.real-http.test.ts`, `IssueStock.test.tsx`, `ReturnStock.test.tsx`, `StockCount.test.tsx`.

**Done when:** AFRI-1325's plate can only be issued to AFRI-1325, comes back to it when returned, and is counted as its own.

## Phase 4: Stock, project and report screens

Size M. Frontend and reporting. Needs Phases 1 to 3.

- [ ] **4.1 Stock shows project stock again.** Stock gets back a Projects view, by project, with each project's material and where it is (reversing the Separation follow-up "Stock is the store's, Stores only"). Stores keeps reorder levels and statuses; project stock has none. *Phase 2 added a stopgap: a "Held for projects" list above the table, linking each item to its page.*
  Files: `pages/Stock.tsx`, `components/LeftoversNotice.tsx`, `pages/Dashboard.tsx`
- [ ] **4.2 A project's page and a Projects item's page show stock in the store.** The project lists its stock by item and location; a Projects item lists how much is held for each project. *The item's side was built in Phase 2 ("In the store for projects").*
  Files: `pages/Projects.tsx`, `pages/MaterialDetail.tsx`, `lib/projectStatus.ts`
- [ ] **4.3 Reports.** Month-end and the stock report show project stock by project; consumption still counts issues by `project_number`, so a project's consumption is unchanged, and project material now also shows as received and on hand in between. *Phase 2 already totals held stock under its project in month-end, the inventory report and the Dashboard; what is left is showing it by project on screen and in the exports.*
  Files: `reporting/month-end.service.ts`, `month-end-export.ts`, `report.service.ts`, `report-export.ts`, `consumption.service.ts`, `pages/MonthEnd.tsx`, `api/exportMonthEnd.ts`

Tests: `StockSections.test.tsx`, `MaterialsSections.test.tsx`, `month-end.service.test.ts`, `consumption.test.ts`, `report.service.test.ts`.

**Done when:** the storeman can see, on Stock and on the project, everything held for AFRI-1325 and where it is.

## Phase 5: Closing a project, docs and ADR

Size S–M. Backend, frontend and docs.

- [ ] **5.1 A closed project's stock goes to Stores, not its item.** Closing still moves nothing by itself: the stock held for a Completed or Cancelled project is flagged on Project leftovers, and **Move to Stores** posts a pair of movements that take it off the project and put it on Stores stock, at the same location. The item stays a Projects catalogue item, as other projects may still order it. The per-item move from the Materials Sections Roadmap is retired.
  Files: `project-leftovers.service.ts`, `pages/ProjectLeftovers.tsx`, `components/LeftoversNotice.tsx`
- [ ] **5.2 `materials.project_number` is no longer read.** Once the stock carries the project, nothing needs the item's. It stays in the schema until a later clean-up migration.
- [ ] **5.3 Docs.** ADR-025 records that project material comes through the store, held for its project, and amends ADR-021 and ADR-023. Also the change log, the purchase order lifecycle, the role table, the resource model, the menu and page inventory, `task_context.md`, the product roadmap, and notes on the Separation, Project on the Order and Materials Sections roadmaps pointing here.

**Done when:** a closed project's stock is moved to Stores with its history intact, and the docs describe the store as it works.

## Releasing

- **Phase 1:** back up the database (`pg_dump`) before deploying: the migration changes the `inventory_balances` primary key. No data changes; every balance keeps its quantity as Stores stock.
- **Phase 2:** no migration; the store controller already has `receive:purchase_order`. Deploy it with Phase 3, since stock received for a project can't be issued until then. Tell Procurement that Confirm delivery is gone and the storeman now books project deliveries.
