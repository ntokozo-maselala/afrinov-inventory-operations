# Afrinov Inventory Platform: Procurement Alignment Roadmap

Oct 19, 2026 · Sbonakaliso Ngcobo

## Summary

Seven phases that bring purchase orders in the app up to the **AFRI-0000_x R0 - Item Description** workbook, which is the company's purchase order template. The app already had the order workflow (approval, receiving, close and cancel). What it lacked was what the template prints: prices, VAT, terms, delivery details, the project and a document to send the supplier.

**Status:** Phases 1 to 6 are built, pushed and waiting for review. All 30 rows of the [field map](#field-map) now match the template. Phase 7, switching procurement on everywhere, is next.

| Phase | What | Branch | Commit | Status |
|---|---|---|---|---|
| 1 | Supplier master | `feature/supplier-master` | `0a632bd` | Shipped |
| 2 | Prices and VAT | `feature/po-pricing` | `b59f55d` | Shipped |
| 3 | Order details | `feature/po-details` | `78f3a55` | Shipped |
| 4 | Approval by value | `feature/po-approval` | `5855cef` | Shipped |
| 5 | Printable purchase order | `feature/po-document` | `975c21f` | Shipped |
| 6 | Numbers and revisions | `feature/po-numbers` | `5b46fc6` | Shipped |
| 7 | Switch on everywhere | `feature/procurement-on-by-default` | `930b7c4` | In review |

Sizes used below: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## How to run this

### Where things stand (20 October 2026)

- Phases 1 to 6 are in `main` (PRs #46 to #49 and the ones after), as is the [Procurement Workflow Roadmap](procurement-workflow-roadmap.md).
- Procurement is back in scope. It was taken out of the Platform Flow Roadmap on 12 October.
- Phase 7 is in review: `feature/procurement-on-by-default` turns procurement on by default (ADR-019). Until it is merged, procurement is on only where the two `.env` files turn it on.
- The new real-HTTP tests in `apps/backend/integration/` have not run on a developer machine (they need `SEED_ADMIN_PASSWORD`); they run in the `integration` job in CI.

### Before release, on every database

1. Apply migrations `20260101000013` to `20260101000018`.
2. Run `npm run import:suppliers` to load the vendor list. It has not been applied anywhere yet.
3. Under **Settings → Purchase orders**, fill in the delivery contact, the Code of Conduct and the **First AFRI number** (one past the last number issued from the workbook).
4. Under **Settings → Users & permissions**, set each approver's approval limit.

### Order of work

Phases 1, 2 and 6 don't depend on each other. Phase 3 needs Phase 1 (payment terms come from the supplier), Phase 4 needs Phase 2 (it uses the order total), Phase 5 needs Phases 2 and 3, and Phase 7 comes last.

### Decisions

| Decision | Choice | Decided | Phase |
|---|---|---|---|
| VAT on orders in other currencies | Rand orders use the VAT setting; other currencies start at 0%; either can be changed on the order | 19 Oct 2026 | 2 |
| Project code on every order | Optional: general store stock is bought without one | 19 Oct 2026 | 3 |
| How contacts are captured | Typed, with defaults from Settings and the person raising the order | 19 Oct 2026 | 3 |
| How approval limits are set | A limit per user, compared with the total including VAT; orders with unpriced lines can't be approved | 19 Oct 2026 | 4 |
| Order number format | The template's `AFRI-0000` style | 19 Oct 2026 | 6 |
| When the revision goes up | Each time an approved order is changed | 19 Oct 2026 | 6 |

The approval decision is not yet recorded as an ADR in the decision log.

### Rule of thumb

Copy what the template means, not how it works. Its formulas have faults (see [Template faults not to copy](#template-faults-not-to-copy)), and it holds five lines at most. Values that belong to Afrinov, such as the VAT number and delivery address, go in Settings, not in code.

## Phase 1: Bring the supplier record up to the template

**Shipped** on `feature/supplier-master` (commit `0a632bd`). Size M. Backend and frontend, with a migration. 25 new backend tests and 14 frontend tests.

The template's Suppliers sheet has 181 vendors with ten columns. The app kept four of them: name, contact person, phone and email. Payment terms, currency and the vendor code all come from the supplier on the printed order, and no role could edit a supplier.

- [x] **1.1 Add the missing supplier fields.** `Supplier` gains `vendorCode` (unique, stored upper-case), `address`, `currency` (ZAR, USD, EUR or GBP; existing suppliers get ZAR), `paymentTerms`, `website` and `services`. The migration only adds columns. One set of rules tidies them for the app and the import: "COD" and "c.o.d" become `C.O.D`, "30 Days Nett" becomes `30 DAYS NETT`, and "EUROS" becomes EUR. Payment terms stay free text, with the common ones suggested.
  Files: `backend/prisma/schema.prisma`, `migrations/20260101000013_supplier_template_fields`, `procurement/supplier-fields.ts`
- [x] **1.2 Add an edit-supplier route.** `PATCH /suppliers/:id` (`edit:supplier`) edits, deactivates and reactivates, with before and after in the audit log, and `GET /suppliers/:id` returns one supplier. A name or vendor code another supplier has is refused with 409, naming that supplier. Added beyond the plan: an inactive supplier can no longer get a new purchase order, as Receive stock already refused.
  Files: `procurement.routes.ts`, `procurement.service.ts`, `openapi/document.ts`
- [x] **1.3 Show and edit the fields in the app.** The supplier form adds and edits, so "New supplier" on Receive stock asks for the same fields. Supplier detail has a Purchasing panel, Edit, Deactivate (asks first), Reactivate and "Add one" when the vendor code is missing. The Suppliers list has Code and Payment terms columns, services under each name and a tag on non-ZAR suppliers, and search matches codes and services. The purchase order form lists active suppliers only.
  Files: `components/SupplierForm.tsx`, `pages/Suppliers.tsx`, `pages/SupplierDetail.tsx`, `pages/PurchaseOrders.tsx`, `mock/mockApi.ts`
- [x] **1.4 Import the 181 vendors from the workbook.** Its own command, `npm run import:suppliers`. It is a dry run with a report unless given `--apply`. It fills only empty fields on existing suppliers, so it is safe to run again. Against the local database it would create 177 suppliers, fill in 2 and leave out 3 duplicate names: Hydac V026 and BMG V025 (near-empty rows) and Afrox V035 (the Midrand branch; rename it in the workbook to load it). It also reports 4 invalid emails and 1 row without a vendor code.
  Files: `backend/scripts/import-suppliers.ts`, `modules/migration/vendor-list.ts`

**Done when:**
- Every vendor in the Suppliers sheet is in the app with its code, address, currency and payment terms.
- A store controller or buyer can correct a supplier's details without Admin.

## Phase 2: Put prices and totals on the order

**Shipped** on `feature/po-pricing` (commit `b59f55d`), built on Phase 1. Size M. Backend and frontend, with a migration. 13 new backend tests and 13 frontend tests.

The template's lines carry unit price, subtotal, VAT and net value, with a total at the bottom. In the app, an order line held only a quantity. The API accepted `unitPrice` and then dropped it, because there was no column to keep it in.

- [x] **2.1 Store the unit price on each line.** `PurchaseOrderLine.unitPrice` keeps the price the API already accepted, excluding VAT. Orders keep their `currency` (from the supplier) and `vatRate`, both fixed when the order is raised. Migration `20260101000014` gives existing orders ZAR and 15%, with no prices; those can be added from Edit while the order is editable.
  Files: `schema.prisma`, `migrations/20260101000014_po_prices_and_vat`, `procurement.service.ts`
- [x] **2.2 Add a VAT rate setting.** `purchaseOrders.vatRate`, 15 by default, under Settings → Purchase orders. Rand orders start at the setting, orders in other currencies at 0%, and the buyer can change the rate on any order.
  Files: `settings.service.ts`, `pages/SettingsSections.tsx`
- [x] **2.3 Work out totals in one place.** `po-pricing.ts`: subtotal = price × quantity, VAT = subtotal × rate, each rounded to cents (half up) before summing, in decimals. The list and detail return per-line subtotal, VAT and net and the order totals. Lines without a price are left out of the total and counted, rather than counted as R 0.
  Files: `procurement/po-pricing.ts`, `procurement.service.ts`
- [x] **2.4 Prices in the order form and detail page.** The new-order form has a unit price per line, starting from the item's unit cost, a VAT rate from the supplier's currency and a running total. Detail shows unit price, subtotal, VAT and net value per line, an order total block, and "Add prices" when lines have none. The Edit drawer changes prices and the VAT rate, and the list has a Total column.
  Files: `pages/PurchaseOrders.tsx`, `pages/PurchaseOrderDetail.tsx`, `lib/poMoney.ts`, `mock/mockApi.ts`

**Done when:**
- An order's totals match what the template would print for the same lines.
- Changing the VAT setting doesn't change orders already raised.

## Phase 3: Capture the order details the template asks for

**Shipped** on `feature/po-details` (commit `78f3a55`), built on Phase 2. Size M. Backend and frontend, with a migration. 6 new backend tests and 12 frontend tests.

The template's Inputs sheet collects the project, terms, discount, penalties and where the goods go. The app asked only for supplier, notes and lines.

- [x] **3.1 Link orders to a project.** The project is optional, so general store stock is bought without one. Unknown or inactive projects are refused. The list filters by project (`?project=`), and the project on an order links to all its orders, as Projects has no detail page.
  Files: `schema.prisma`, `procurement.routes.ts`, `pages/PurchaseOrders.tsx`
- [x] **3.2 Commercial terms.** Payment terms (copied from the supplier, editable), payment milestone (shown as N/A when blank), settlement discount (0 to 100%), shipping terms and penalties ("apply" or "none", none by default).
  Files: `schema.prisma`, `procurement.service.ts`
- [x] **3.3 Delivery block.** "Delivery to address" or "Collection by Afrinov". Delivery to, address, country and the site contact come from five new settings; the address starts as 10 Lime Street, Icon Industrial Park. Contacts are typed, with defaults, not picked from users. The site contact starts blank, because staff names and numbers stay out of the repository. The Afrinov contact defaults to whoever raises the order.
  Files: `schema.prisma`, `settings.service.ts`, `migrations/20260101000015_po_order_details`
- [x] **3.4 Delivery date per line.** An optional `deliveryDate` per line, set on the new order or in Edit. Lines without one are due on the order's expected date. Detail has a Due column, and a line still owed after its date on an order that can be received shows **Late**.
  Files: `schema.prisma`, `pages/PurchaseOrderDetail.tsx`
- [x] **3.5 Lay out the order form in the template's order.** The new-order form and the Edit drawer follow the template (supplier information, order information, delivery information, lines, remarks) through one shared `PurchaseOrderDetailsFields`. Detail shows an "Order details" panel. Edits log only the fields that changed.
  Files: `components/PurchaseOrderDetailsFields.tsx`, `pages/PurchaseOrders.tsx`, `pages/PurchaseOrderDetail.tsx`, `mock/mockApi.ts`

**Done when:**
- Everything on the template's Inputs sheet can be entered in the app.
- Picking a supplier fills its payment terms, currency and vendor code.

## Phase 4: Route approval by order value

**Shipped** on `feature/po-approval` (commit `5855cef`), built on Phase 3. Size M. Backend and frontend, with a migration. 14 new backend tests and 12 frontend tests. Approval limits start blank (no limit) until an admin sets them.

The template names the approver by order total: one approver below R500 000 and a more senior one from R500 000. In the app, any user with `approve:purchase_order` could approve any order.

- [x] **4.1 How approval limits are set.** A limit per user, compared with the order total including VAT, and an order with unpriced lines can't be approved. Anyone whose role may approve has an approval limit in rand; blank means no limit. Limits are in rand, so orders in other currencies need someone without a limit. To match the template, set 500 000 on the junior approver and leave the senior approver blank.
  Files: `schema.prisma`, `migrations/20260101000016_po_approval_limits`, `identity.service.ts`
- [x] **4.2 Enforce it on the server.** `po-approval.ts`. `approve` refuses unpriced orders (400) and orders over the approver's limit (403), naming who can approve them: "This order is R 690 000,00 including VAT; your approval limit is R 500 000,00. Ask … to approve it." Editing an approved order past its approver's limit, or removing a price, sends it back to Pending approval.
  Files: `procurement/po-approval.ts`, `procurement.service.ts`
- [x] **4.3 Show who needs to approve.** A pending order shows the total including VAT, whether you can approve, why not, and who can (with their limits), or "Waiting for prices". Approve shows only to someone whose limit covers the order. Added beyond the plan: approvers could approve but not open orders, so the role gains `view:purchase_order` (also granted by the migration). The order page now shows Edit, Cancel, Close and Receive only to roles the server allows.
  Files: `pages/PurchaseOrderDetail.tsx`, `pages/SettingsSections.tsx`, `hooks/usePermissions.ts`, `shared/permissions.ts`

**Done when:**
- An order of R500 000 or more can't be approved by someone whose limit is lower, and the screen says who can.

## Phase 5: Produce the purchase order document

**Shipped** on `feature/po-document` (commit `975c21f`), built on Phase 4. Size M to L. Mostly frontend, with a migration. 10 new frontend tests; sample copies checked by eye.

**Where it shows:** Purchase orders → an order → **Download PDF**, and Settings → Purchase orders → **Printed on the purchase order**.

The Order sheet is what the supplier receives. The app couldn't produce anything to send, so a buyer would still have had to fill in the workbook.

- [x] **5.1 Company details in Settings.** Under Settings → Purchase orders, "Printed on the purchase order": company VAT number (4010288142), invoice email (accounts@afrinov.co.za) and Code of Conduct. Migration `20260101000017` adds them. The company name comes from General → Company name, and the delivery address from Phase 3's delivery settings. The Code of Conduct starts blank, because the template's was empty; it is left off the PDF until an admin adds it.
  Files: `settings.service.ts`, `pages/SettingsSections.tsx`
- [x] **5.2 Lay out the document like the Order sheet.** An A4 portrait PDF: logo and order number; supplier and delivery details beside the order details; the lines (item, units, description, unit price, qty, delivery date, subtotal, VAT, net value) with the order total; remarks, the invoice note, Code of Conduct, and originator, authorization and supplier acceptance boxes. Long orders run onto more pages with the total on the last.
  Files: `lib/poDocument.ts`
- [x] **5.3 Download as PDF.** **Download PDF** on the order page, for anyone who can open the order. Orders not yet approved are stamped "DRAFT - NOT FOR ISSUE" on every page and cancelled ones "CANCELLED"; files are named after the order (`AFRI-0412.pdf`, `…-draft.pdf`). **Changed from the plan:** built in the browser like the app's report PDFs, not on the server, so it also works in frontend-only mode. The totals come from the server, so copies match the screen. A server-built copy would be a separate step if orders are ever emailed automatically.
  Files: `pages/PurchaseOrderDetail.tsx`, `lib/pdf.ts`

**Done when:**
- A buyer can raise, approve and send a purchase order without opening the workbook.
- Placed side by side, the PDF and the template's Order sheet carry the same fields.

## Phase 6: Order numbers and revisions

**Shipped** on `feature/po-numbers` (commit `5b46fc6`), built on Phase 5. Size S to M. Backend and frontend, with a migration. 6 new backend tests and 5 frontend tests.

The template's number is its file name (`AFRI-0000_x`) and it carries a revision (Rev 00). The app numbered orders `PO-2026-0001` and kept no revision.

- [x] **6.1 The number format.** The template's `AFRI-0000` style. New orders are AFRI-0001, AFRI-0002, and so on: one past the highest AFRI number issued, never below the **First AFRI number** setting, so lowering it can't reuse a number. Older `PO-2026-…` orders keep their numbers. Numbering still runs under the advisory lock. This also fixes the old count-based numbering, which could repeat a number.
  Files: `procurement.service.ts` (`generatePONumber`)
- [x] **6.2 Revisions.** The revision goes up when an approved order is changed; drafts and saves that change nothing stay put. The change and the revision are logged, and edits now log only fields whose values change. "Rev 00" shows under the order's title, next to its number in the list once revised, on the PDF, and in the PDF's file name (`AFRI-0412-rev01.pdf`).
  Files: `schema.prisma`, `migrations/20260101000018_po_numbers_and_revisions`, `procurement.service.ts`, `lib/poDocument.ts`

**Done when:**
- A changed order goes to the supplier as a new revision with the same number.

## Phase 7: Switch procurement on everywhere

**In review** (`feature/procurement-on-by-default`, `docs/bring-up-to-date`). Size S. Config and docs. Needs Phases 1 to 6.

Procurement is shown only where both `.env` files turn it on. Staging, production and anyone else's machine still hide it.

- [x] **7.1 Turn the switch on by default.** *Done in code (ADR-019); still to check: the deployed environments do not set either variable to `false`.* Change the default to on in `config.ts` and `features.ts`, set `PROCUREMENT_ENABLED` in `docker-compose.yml` and the deployed environments, and update both `.env.example` files. Keep the switch so it can be turned off again.
  Files: `backend/src/shared/config.ts`, `frontend/src/config/features.ts`, `docker-compose.yml`, `.env.example`
- [ ] **7.2 Check roles end to end.** Sign in as Procurement, Approver (each level), Store controller and Viewer, and walk an order from draft to closed. Add the procurement actions to the role check sheet test. Rerun the seed where permissions changed.
  Files: `hooks/usePermissions.test.tsx`, `pages/RoleGating.test.tsx`, `db/seed.ts`
- [ ] **7.3 Update the docs and retire the workbook.** *Docs updated (README, `task_context.md`, the product roadmap's Milestone 3, `workbook-replacement-roadmap.md` and `afrinov-docs/`); still to do: tell buyers the date from which orders are raised in the app only.* Update the README, `task_context.md`, the product roadmap's Milestone 3 and `workbook-replacement-roadmap.md`. Tell buyers the date from which orders are raised in the app only.

**Done when:**
- Every environment shows Purchase orders and Goods receipts.
- No new orders are raised from the workbook.

## Field map

Each field on the template, where the app holds it, and the phase that closed the gap.

| Template field | In the app | Status | Phase |
|---|---|---|---|
| **Supplier (Suppliers sheet)** | | | |
| Vendor name | `Supplier.name` | Matches | — |
| Contact person, number, email | `contactName`, `contactPhone`, `contactEmail` | Matches | — |
| Vendor code | `vendorCode` | Matches | 1 |
| Physical address | `address` | Matches | 1 |
| Currency | `currency` | Matches | 1 |
| Payment terms | `paymentTerms` | Matches | 1 |
| Website, services and supplies | `website`, `services` | Matches | 1 |
| **Order header (Inputs and Order sheets)** | | | |
| Supplier | `PurchaseOrder.supplierId` | Matches | — |
| Order date | `createdAt` | Matches | — |
| Originator | `createdBy` | Matches | — |
| Remarks | `notes` | Matches | — |
| Purchase order no. | `AFRI-0001` onwards, from the First AFRI number setting | Matches | 6 |
| Revision | `revision`, raised by edits after approval | Matches | 6 |
| Approver (by value) | `User.approvalLimit`, checked on approve | Matches | 4 |
| Project code | `projectNumber`, optional | Matches | 3 |
| Payment terms, milestone, settlement discount | `paymentTerms`, `paymentMilestone`, `settlementDiscount` | Matches | 3 |
| Shipping terms | `shippingTerms` | Matches | 3 |
| Penalties apply / not | `penaltiesApply` | Matches | 3 |
| Delivery to / Collection, address, country, contact, phone | `deliveryMethod` and the delivery block, from Settings | Matches | 3 |
| Afrinov contact | `afrinovContact`, typed | Matches | 3 |
| Currency and vendor code on the order | `PurchaseOrder.currency`; vendor code printed from the supplier | Matches | 2, 5 |
| Afrinov VAT number, invoice email, Code of Conduct | Settings, printed on the PDF | Matches | 5 |
| Supplier acceptance | Box on the PDF | Matches | 5 |
| **Lines and totals** | | | |
| Item, units, description | `material` (name, `unitOfMeasure`) | Matches | — |
| Qty | `orderedQty` | Matches | — |
| Delivery date | `deliveryDate` per line, else the order's expected date | Matches | 3 |
| Unit price | `PurchaseOrderLine.unitPrice` | Matches | 2 |
| Subtotal, VAT, net value | Per line from `po-pricing.ts`; VAT rate on the order | Matches | 2 |
| Total amount of purchase order | `totals` on list and detail | Matches | 2 |
| **Output** | | | |
| The Order sheet itself | Download PDF on the order | Matches | 5 |

## Template faults not to copy

Found in the workbook's formulas:

- **The approver never changes.** `Inputs!F7` tests `Order!K38`, which is in the Remarks area, not the total in `K35`. Every order names the same approver, whatever its value.
- **Lines 3 to 5 mix two items.** Order rows 32 to 34 take Item and Units from Inputs rows 55, 57 and 58, but Description, Price and Qty from rows 50, 51 and 52.
- **Five lines at most**, with VAT fixed at 15%, including for the supplier that invoices in euros.
- **Order date is `TODAY()`**, so reopening an old order changes its date.
- **Payment terms are inconsistent** across the 181 suppliers ("C.O.D" and "COD", "30 DAYS NETT" and "30 Days Nett").

## Before each pull request

- Update `mock/mockApi.ts` for any new or changed endpoint, so `npm run dev:frontend-only` keeps working.
- Add new endpoints to `openapi/document.ts`, and keep `openapi.test.ts` green.
- Migrations only add columns or tables, with defaults, so existing orders stay valid.
- From `afrinov-platform/`, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. For backend changes, also run `npm run test:integration` (including `procurement.real-http.test.ts`).
- Sign in as Procurement, Approver and Store controller, and walk the order the phase changes.
- Check the field map above and mark what the phase closed.

File references are relative to `afrinov-platform/apps/`.
