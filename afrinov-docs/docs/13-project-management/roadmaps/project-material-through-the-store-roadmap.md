# Afrinov Inventory Platform: Project Material Through the Store Roadmap

Nov 2, 2026 · Sbonakaliso Ngcobo

## Summary

Five phases that bring project material back into the store. The [Stores and Procurement Separation Roadmap](stores-procurement-separation-roadmap.md) decided that project material goes from the supplier straight to site, so a project order is never received into stock: Procurement confirms its delivery on the order and no stock is added (ADR-021, Phase 3). That is not how the store works. On 2 Nov 2026 the business confirmed:

- **All** project material comes through the store.
- The **storeman** books its delivery, not Procurement.
- The same catalogue item **can** be bought for two projects at once.

The third answer decides the design. Since the [Project on the Order Roadmap](project-on-the-order-roadmap.md) (ADR-023), the project lives on the order, not the item, and any Projects item can go on any project order. So the item can't say whose stock is on the shelf: 10 m of `10mm Plate` for AFRI-1325 and 6 m for P-42 are the same item at the same location. **Stock has to carry its project.** After this roadmap every stock movement and balance says which project the stock is *held for* (none for Stores stock), the storeman receives project orders on Receive stock, and Issue stock issues each project's own stock to it.

It amends ADR-021 (straight to site; Procurement confirms delivery) and ADR-023 (only leftovers carry a project, on the item). Recorded as ADR-025 in Phase 5.

**Status:** Phases 1 to 4 built and merged: #142, #143, #145 and #146, with #147 adding the settings rows Phase 4 needs. Phase 5 proposed.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | Stock is held for a project | L | Built |
| 2 | The storeman receives project orders | M | Built |
| 3 | Issue, return and move by project | M | Built |
| 4 | Receive and issue straight away | M | Built |
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
| Stock page | Stores only, with leftovers listed above | Stores only, with project material received and not yet issued listed above, by project |
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
| Issuing one project's stock to another | Refused. Moving stock between projects is left out of this roadmap; a closed project's stock still goes to Stores | 3 Nov 2026 |
| Leftovers from before | Keep their project on the item, as Stores stock: no migration gives their stock a project (step 3.0 dropped), so Move to Stores keeps working. Issue stock treats them as their item's project's | 3 Nov 2026 |
| What happens to project material once received | It goes straight to the workshop and is issued right away: it is never shelved, so the storeman never transfers or adjusts it | 3 Nov 2026 |
| Counting project stock | Count stock stays Stores-only | 3 Nov 2026 |
| Moving or adjusting project stock on screen | Not needed: the server keeps a project's stock its own when moved or adjusted, but no screen offers it | 3 Nov 2026 |
| Where project deliveries are booked | One project receiving location (such as Workshop floor), chosen by an administrator; none set means a location per line, as before | 3 Nov 2026 |
| From receiving to issuing | After a project delivery is booked, "Issue it now" opens Issue stock with the project and what arrived filled in | 3 Nov 2026 |

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

## Phase 3: Issue, return and move by project

Size M. Backend and frontend. Needs Phase 1.

*Built on `feature/project-stock-3` (PR #145), with no migration.* Two changes from the plan: **step 3.0 is dropped**, since giving leftovers' stock a project would have stopped Move to Stores working for them (it refuses an item with stock held for a project, step 2.0) until Phase 5; and **counts stay Stores-only**, as project material isn't shelved.

- [ ] ~~**3.0 Leftovers' stock takes their project.**~~ Dropped (see above): leftovers stay Stores stock with their project on the item.
- [x] **3.1 Issue stock takes from the project's own stock.** Each issue line names the stock it takes (`heldForProject`). Stock held for a project is offered as its own line ("A-1 · held for AFRI-1325"), and choosing it sets the issue's project, as a leftover does; with a project chosen, that project's held stock and its leftovers are offered, and no Stores items. The server issues a project's own stock to that project only (400 for another project or none), checks the quantity against that stock, and keeps Stores stock to its item's rules. A closed or inactive project's held stock isn't offered.
  Files: `pages/IssueStock.tsx`, `inventory.service.ts`, `inventory.routes.ts`, `pages/MaterialDetail.tsx`, `mock/mockApi.ts`
- [x] **3.2 A return goes back to the stock it came from.** Already so since Phase 1 (returns and reversals copy the original's `heldForProject`); now covered by a test.
- [x] **3.3 Transfers and adjustments keep the project.** `POST /inventory-transfers` and `/inventory-adjustments` take an optional `heldForProject` and keep the stock that project's (404 for an unknown project). No screen offers it; counts stay Stores-only.
  Files: `inventory.service.ts`, `inventory.routes.ts`, `openapi/document.ts`

Also built in review on PR #145: movement history filtered or searched by a project finds its own stock received, moved or adjusted, as well as stock used for it (the movement report too); a movement that moves a project's own stock without naming a project it was used for reads "held for AFRI-1325" in the Movements table and its exports, and the details panel shows "Held for"; the item page offers Issue only for stock that can be issued.

Tests: `procurement.real-http.test.ts` (project stock issued only to its project; a return putting it back; transfer and adjust keeping its project; project history finding a transfer), `IssueStock.test.tsx`, `MaterialDetail.test.tsx`, `history-filter.test.ts`, `TransactionDrawer.test.tsx`, `mockDelivery.test.ts`.

**Done when:** AFRI-1325's plate can only be issued to AFRI-1325, and comes back to it when returned.

## Phase 4: Receive and issue straight away

Size M. Frontend, with a setting. Needs Phases 1 to 3.

*Built on `feature/project-stock-4` (PR #146); its setting row came with #147.* Replanned on 3 Nov 2026: the business confirmed that project material is issued to the workshop as soon as it is received and is never shelved, so project stock is in the store only between receipt and issue. The planned Projects view of Stock, project stock on the project's page, and report lines by project became a short list of what is received and not yet issued; reports keep the project totals Phase 2 added.

- [x] **4.1 Issue it now.** After a project delivery is booked on Receive stock, the confirmation offers **Issue it now**, which opens Issue stock with the project locked and what arrived filled in (added up per item and location, and no more than is still held). Issue stock says when some lines can no longer be issued.
  Files: `pages/ReceiveStock.tsx`, `pages/IssueStock.tsx`, `lib/issuePrefill.ts`
- [x] **4.2 A project receiving location.** A setting, `inventory.projectReceivingLocationId` (Settings → Inventory), names where project deliveries are booked, such as Workshop floor; the server accepts only an active location. With it set, a project order's lines on Receive stock show no location to choose ("Booked to Workshop floor, the project receiving location"). With none set the storeman chooses per line, as before; with one no longer in use, Receive stock warns and leaves the lines to choose rather than guessing.
  Files: `settings.service.ts`, `pages/SettingsSections.tsx`, `pages/ReceiveStock.tsx`, `components/OrderReceiptLines.tsx`, migration `20260101000038_project_receiving_location` (#147)
- [x] **4.3 Received for projects, not yet issued.** Replaces the temporary box on Stock and shows on Projects: per project, what it holds, with **Issue** opening Issue stock with that project's lines. Stock Issue can't take (an inactive item or location, a tool, a closed or inactive project) stays listed with the reason. The Projects page says when the list couldn't load.
  Files: `components/LeftoversNotice.tsx`, `pages/Projects.tsx`, `pages/Stock.tsx`

Also found while building it (#147): a setting's row is created only by the seed, so the stock status thresholds (`inventory.urgentBelowPercent`, `warningBelowPercent`) had no row on databases seeded before 9 Oct 2026, and Settings → Inventory failed to open there. Migration `20260101000039_stock_status_threshold_settings` adds them, and a migrations test now fails when a new setting has no migration inserting its row.

Tests: `PoReceiveDelivery.test.tsx` (the receiving location, no location to choose, Issue it now, duplicate lines), `IssueStock.test.tsx`, `StockSections.test.tsx`, `ProjectsReceived.test.tsx`, `SettingsInventory.test.tsx`, `settings.service.test.ts`, `migrations.test.ts`. Backend 996 unit and 208 integration tests at #147.

**Done when:** the storeman books a project delivery to the workshop floor and issues it in the next step, and nothing received is forgotten.

## Phase 5: Closing a project, docs and ADR

Size S–M. Backend, frontend and docs.

- [ ] **5.1 A closed project's stock goes to Stores, not its item.** Closing still moves nothing by itself: the stock held for a Completed or Cancelled project is flagged on Project leftovers, and **Move to Stores** posts a pair of movements that take it off the project and put it on Stores stock, at the same location. The item stays a Projects catalogue item, as other projects may still order it. The per-item move from the Materials Sections Roadmap is retired.
  Files: `project-leftovers.service.ts`, `pages/ProjectLeftovers.tsx`, `components/LeftoversNotice.tsx`
- [ ] **5.2 `materials.project_number` is no longer read.** Once the stock carries the project, nothing needs the item's. It stays in the schema until a later clean-up migration. *Since step 3.0 was dropped, leftovers still take their project from the item, so this waits until none are left, or until 5.1 can move them.*
- [ ] **5.3 Docs.** ADR-025 records that project material comes through the store, held for its project, and amends ADR-021 and ADR-023. Also the change log, the purchase order lifecycle, the role table, the resource model, the menu and page inventory, `task_context.md`, the product roadmap, and notes on the Separation, Project on the Order and Materials Sections roadmaps pointing here.

*As project material is issued as it arrives, stock still held when a project closes should be rare; 5.1 covers it, and for leftovers Move to Stores already works.*

**Done when:** a closed project's stock is moved to Stores with its history intact, and the docs describe the store as it works.

## Releasing

- **Phase 1:** back up the database (`pg_dump`) before deploying: the migration changes the `inventory_balances` primary key. No data changes; every balance keeps its quantity as Stores stock.
- **Phase 2:** no migration; the store controller already has `receive:purchase_order`. Deploy it with Phase 3, since stock received for a project can't be issued until then. Tell Procurement that Confirm delivery is gone and the storeman now books project deliveries.
- **Phase 3:** no migration.
- **Phase 4:** run `npx prisma migrate deploy` for migrations 038 and 039 (#147: setting rows only, no schema change). Then create a location such as Workshop floor and choose it under Settings → Inventory → Project receiving location.
