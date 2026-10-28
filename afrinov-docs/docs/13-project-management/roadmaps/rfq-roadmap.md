# Afrinov Inventory Platform: Request for Quotation (RFQ) Roadmap

Oct 28, 2026 · Sbonakaliso Ngcobo

## Summary

Six phases that add requests for quotation to Procurement, aligned with the **RFQ sheet of the AFRI-02A-1094-02-01 Manhours and Material** workbook. Today a buyer fills in that sheet, sends it to suppliers, collects their prices in the "02-Recieved Quotation" folder, compares them by hand and then types the winning prices into a purchase order. In the app, an RFQ is raised from the materials list, sent to several suppliers as a PDF, their quotes are recorded and compared side by side, and the winner becomes a draft purchase order with the quoted prices.

**Status:** Phase 1 is in review (PR #104). One pull request per phase.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | RFQ record and numbering | M | In review |
| 2 | Raise, edit and send an RFQ | M | Planned |
| 3 | The RFQ document for suppliers | M | Planned |
| 4 | Record the quotes that come back | M to L | Planned |
| 5 | Compare quotes and award to a purchase order | M | Planned |
| 6 | Roll out | S | Planned |

Sizes used below: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## How to run this

### Order of work

Each phase needs the one before it. Phase 3 (the PDF) can start once Phase 2 has a saved RFQ to print, alongside Phase 4.

### How it works, start to finish

1. A buyer raises an RFQ: optionally for a project, with the lines (items and quantities) and remarks. It stays a **Draft** while it is being put together.
2. The buyer picks the suppliers to ask and **sends** it. The RFQ becomes **Sent**, gets its issue date, and a closing date four days later (changeable).
3. The buyer downloads one PDF per supplier and emails it to them, as with purchase orders today.
4. Suppliers reply with their quotation, usually on their own letterhead. The buyer opens the RFQ, chooses **Record quote** for that supplier, types in the unit prices, quote reference and validity, and attaches the supplier's PDF. A supplier who won't quote is marked **Declined**.
5. The comparison shows every supplier's prices side by side, with the lowest per line and overall.
6. The buyer **awards** the RFQ to one supplier. A draft purchase order is created with that supplier, the RFQ's project, lines and the quoted prices, and the RFQ becomes **Awarded**. The order then goes through approval as any other.

An RFQ can be **cancelled** while it is a Draft or Sent, with a reason.

### Decisions

| Decision | Choice | Decided | Phase |
|---|---|---|---|
| How much the RFQ does | The full cycle: raise, send to several suppliers, record quotes, compare, award to a draft purchase order | 28 Oct 2026 | All |
| How the award works | One supplier wins the whole RFQ and it becomes one purchase order | 28 Oct 2026 | 5 |
| How prices come back | The supplier replies with their own quotation; the buyer types the prices into the RFQ and attaches the supplier's PDF | 28 Oct 2026 | 4 |
| A link for suppliers to enter their own prices | Later, not in this roadmap (see [Later](#later)) | 28 Oct 2026 | — |
| Who may do what | The purchase order permissions: `create:purchase_order` raises, sends, records and awards; `view:purchase_order` opens RFQs | Proposed | 1 |
| RFQ number | For a project numbered `AFRI-<digits>`, the workbook's document style `AFRI-02A-<digits>-02-<nn>` (e.g. `AFRI-02A-1325-02-01`); for a project numbered otherwise, `RFQ-<project>-<nn>`, so no two projects share a sequence; without a project, `RFQ-0001` onwards | 28 Oct 2026 | 1 |
| Labour (manhours) lines and the Manpower Rate sheet | Left out: they price Afrinov's own work to the client, not what suppliers quote on | **Open** | — |
| Units on a line | The item's unit of measure, as on purchase orders, not a separate list | Proposed | 2 |
| Closing date | Four days after it is sent, as the workbook sets it, and changeable per RFQ | Proposed | 2 |

### Rule of thumb

Copy what the RFQ sheet means, not how it works. Its formulas have faults (see [Workbook faults not to copy](#workbook-faults-not-to-copy)). Wording that belongs to Afrinov, such as the instructions printed for suppliers, goes in Settings, not in code.

## Phase 1: RFQ record and numbering

**In review** (PR #104). Size M. Backend, with a migration, and the mock API. 11 new backend unit tests, 9 real-HTTP tests and 7 frontend mock tests. Qodo's 7 findings on the first push are fixed: project number forms that shared a sequence, quantities finer than the 4 decimal places kept, a project archived while an RFQ was raised, the first Activity entry, the mock's validation and response shape, and a description left with the old project's name.

- [x] **1.1 The tables.** `Rfq` (number, status, project, description, remarks, penalties apply, issued and closing dates, who created, sent, awarded or cancelled it and when, the cancellation reason, and the purchase order it became). `RfqLine` (line number, item, quantity). `RfqSupplier` (the suppliers asked, each with their quote reference, date received, valid until, lead time, notes and whether they declined). `RfqQuotePrice` (one unit price per supplier per line). Status is `DRAFT`, `SENT`, `AWARDED` or `CANCELLED`. The migration only adds tables.
  Files: `backend/prisma/schema.prisma`, `migrations/20260101000025_rfqs`
- [x] **1.2 Numbering.** As decided above, under an advisory lock as purchase orders are, so two RFQs never share a number. A draft moved to another project, or off one, takes that one's next number: nobody outside has seen a draft's number.
  Files: `procurement/rfq.service.ts`
- [x] **1.3 Routes.** `GET /rfqs` (filter by status and project), `GET /rfqs/:id` (with lines, suppliers, quotes and totals), `POST /rfqs`, `PATCH /rfqs/:id` (a draft only), `GET /rfqs/:id/history`. Each change is written to the audit log, for the RFQ's Activity. Routes are gated by `PROCUREMENT_ENABLED`, as purchase orders are.
  Files: `procurement/rfq.routes.ts`, `server.ts`, `openapi/document.ts`
- [x] **1.4 Frontend-only mode.** The same routes in `mock/mockApi.ts`, ahead of the purchase order handlers, whose `/cancel` and `/submit` suffix matches would otherwise catch RFQ paths.

**Done when:**
- An RFQ with lines can be saved and read back through the API, with its number and an Activity entry.

## Phase 2: Raise, edit and send an RFQ

Size M. Frontend and backend.

- [ ] **2.1 The RFQ list.** Procurement → **Requests for quotation**: number, project, description, suppliers asked, quotes in, closing date and status. Buyers land on Draft and Sent. Shows **Closed** beside a Sent RFQ past its closing date.
  Files: `pages/Rfqs.tsx`, `hooks/useNavGroups.tsx`, `App.tsx`
- [ ] **2.2 The RFQ form.** Laid out like the RFQ sheet: project and description at the top, then the lines (item, description, units, quantity), then remarks. Lines are picked from the materials list, with **+ New item** as on the purchase order form; project material only for its own project. The suppliers to ask are picked from active suppliers.
  Files: `pages/RfqForm.tsx`
- [ ] **2.3 Send.** `POST /rfqs/:id/send`: needs at least one line and one supplier; sets the issue date and the closing date. A sent RFQ's lines are fixed; suppliers can still be added, for one who was missed.
  Files: `procurement/rfq.service.ts`, `pages/RfqDetail.tsx`
- [ ] **2.4 Cancel.** `POST /rfqs/:id/cancel` with a reason, from Draft or Sent.

**Done when:**
- A buyer can raise an RFQ for a project, pick three suppliers and send it, and see it in the list as Sent with its closing date.

## Phase 3: The RFQ document for suppliers

Size M. Frontend, with a settings migration.

**Where it shows:** an RFQ → each supplier → **Download PDF**.

- [ ] **3.1 Lay it out like the RFQ sheet.** A4 portrait: the logo, **REQUEST FOR QUOTATION**, the RFQ number, description, issued and closing dates; who it is to (the supplier's name, contact and email); the lines with Item, Description, Units and Qty filled in and **Unit price** and **Subtotal** left blank; Total, VAT and Net value rows left blank; then the instructions and Remarks. Built in the browser like the purchase order PDF, so it works in frontend-only mode.
  Files: `lib/rfqDocument.ts`, sharing the drawing helpers in `lib/poDocument.ts` and `lib/pdf.ts`
- [ ] **3.2 Instructions in Settings.** `rfq.instructions`, under Settings → Purchase orders, starting with the sheet's wording: "Fill in the unit price and subtotal for each line as per the headings below, and return your quotation as a PDF, quoting the RFQ number." Plus where quotes are returned to (an email setting). A migration inserts the rows.
  Files: `settings.service.ts`, `migrations/20260101000026_rfq_settings`, `pages/SettingsSections.tsx`
- [ ] **3.3 File name.** `<RFQ number> - <supplier>.pdf`, so the buyer attaches the right copy to each email. A draft RFQ prints stamped "DRAFT - NOT FOR ISSUE", as orders do.

**Done when:**
- Placed side by side, the PDF and the workbook's RFQ sheet carry the same fields, and a supplier can tell what to quote and which number to quote against.

## Phase 4: Record the quotes that come back

Size M to L. Backend and frontend, with a migration.

- [ ] **4.1 Record a quote.** `PUT /rfqs/:id/suppliers/:supplierId/quote`: a unit price per line (a line can be left unpriced when the supplier doesn't offer it), quote reference, date received, valid until, lead time and notes. Can be corrected until the RFQ is awarded; each change goes in the Activity. **Declined** records a supplier who won't quote.
  Files: `procurement/rfq.service.ts`, `pages/RfqDetail.tsx` (a Record quote dialog with the lines, as the RFQ sheet)
- [ ] **4.2 Attach the supplier's PDF.** The app stores no files yet. Add `RfqQuoteFile` (file name, size, uploaded by and when, and the file itself), PDF only, up to 10 MB. The upload route has its own body limit, as the API's is 1 MB. Anyone who can open the RFQ can download it.
  Files: `schema.prisma`, `migrations/20260101000027_rfq_quote_files`, `procurement/rfq.routes.ts`, `server.ts`
- [ ] **4.3 Totals.** Each quote's subtotal per line, total, VAT and net value, worked out by `po-pricing.ts` so they round as orders do. VAT from the supplier's currency, as on orders.

**Done when:**
- Every supplier asked shows Awaiting quote, Quoted (with its total) or Declined, and a quoted supplier's PDF opens from the RFQ.

## Phase 5: Compare quotes and award to a purchase order

Size M. Backend and frontend.

- [ ] **5.1 Comparison.** On the RFQ, a table with a row per line and a column per quoting supplier: unit price and subtotal, the lowest per line marked, and each supplier's total, VAT and net value at the foot, with lead time and validity. Shows a warning beside a quote past its valid-until date, and the number of lines a supplier left unpriced. Suppliers in other currencies are not compared on value, only shown.
  Files: `pages/RfqDetail.tsx`, `lib/rfqCompare.ts`
- [ ] **5.2 Award.** `POST /rfqs/:id/award` with the chosen supplier. In one transaction: the RFQ is locked, checked still Sent, a draft purchase order is created (supplier, project, penalties, remarks, lines with the quoted prices) and the RFQ becomes Awarded with a link to the order. The order's Activity starts "Raised from RFQ …". Awarding someone other than the lowest asks for a reason, kept in the Activity.
  Files: `procurement/rfq.service.ts`, `procurement.service.ts` (`create` takes an optional transaction, as `postGoodsReceipt` does)
- [ ] **5.3 Links both ways.** The order shows "From RFQ …" in its summary; the RFQ shows the order and its status.
  Files: `pages/PurchaseOrderDetail.tsx`, `pages/RfqDetail.tsx`

**Done when:**
- A buyer can award an RFQ in one click and lands on a draft order with the winning prices, ready to submit for approval.

## Phase 6: Roll out

Size S. Tests and docs.

- [ ] **6.1 Check roles end to end.** Sign in as Procurement (raise, send, record, award), Approver and Store controller (no RFQ menu), and Viewer. Add RFQ actions to `RoleGating.test.tsx` and the sidebar tests.
- [ ] **6.2 Real-HTTP test.** In `backend/integration/`: raise, send, record two quotes, award, then check the order and both Activity logs; two awards at once give one order.
- [ ] **6.3 Docs.** The product roadmap's Milestone 3, `workbook-replacement-roadmap.md`, and this roadmap's status. Tell buyers the date from which RFQs are raised in the app.

**Done when:**
- No new RFQs are raised from the workbook.

## Field map

Each field on the workbook's RFQ sheet and where the app holds it.

| RFQ sheet field | In the app | Phase |
|---|---|---|
| **Header** | | |
| Afrinov logo (rows 1 to 8) | Printed on the PDF | 3 |
| RFQ No (from the file name) | `Rfq.number` | 1 |
| Description (from the file name) | `Rfq.description`, starting from the project's name | 2 |
| Issued (`=TODAY()`) | `issuedAt`, set when sent | 2 |
| Closing (Issued + 4) | `closingDate`, issued + 4 days, changeable | 2 |
| Penalties apply / none (list in L2:L3) | `penaltiesApply`, carried to the order | 1, 5 |
| **Lines** | | |
| Item | Line number | 1 |
| Description | The item's code and name | 2 |
| Units (HRS, LOTS, PC, DAYS, ADD) | The item's unit of measure | 2 |
| Qty | `RfqLine.quantity` | 1 |
| Unit price | Blank on the PDF; `RfqQuotePrice.unitPrice` per supplier | 3, 4 |
| Subtotal | Blank on the PDF; worked out per quote | 3, 4 |
| **Totals** | | |
| Total amount, VAT, Net value | Blank on the PDF; worked out per quote | 3, 4 |
| **Foot** | | |
| Instructions ("Fill … and save as PDF", "All files to be returned as PDF") | `rfq.instructions` setting | 3 |
| Remarks | `Rfq.notes` | 2 |
| **Not carried over** | | |
| Labour lines priced from the Manpower Rate sheet | Out of scope (decision open) | — |
| Selling price at 1.4 × total (G50, outside the print area) | Out of scope: Afrinov's pricing to the client | — |

## Workbook faults not to copy

Found in the RFQ sheet's formulas:

- **The RFQ number is cut short.** `B9` takes the first 10 characters of the file name, so `AFRI-02A-1094-02-01 …` prints as `AFRI-02A-1`, which leaves out the enquiry number.
- **Dates move.** Issued is `=TODAY()` and Closing is Issued + 4, so reopening an old RFQ changes both dates.
- **"Total amount of purchase order" on a request for quotation.** The label was copied from the order template.
- **Supplier prices typed into Afrinov's sheet.** The copy kept in "02-Recieved Quotation" holds one set of prices (`E15:E24`), so a second supplier's quote overwrites the first. The app keeps a quote per supplier.
- **Missing subtotals.** `F25:F28` have no formula, so prices typed on those rows are left out of the total.
- **The last labour row looks up the wrong column.** `E49` looks for column 4 in a two-column range, and `IFERROR` turns the error into 0.

## Later

- **A link for suppliers.** Each supplier gets a private one-time link and enters their prices in the app, so nothing is retyped. Needs the app reachable from the internet and secure links for people who aren't users.
- **Splitting the award by line**, with one purchase order per winning supplier.
- **Emailing the RFQ from the app**, once mail is set up on the server.
- **Labour and estimating**, if the Manhours part of the workbook is brought into the app.

## Before each pull request

- Update `mock/mockApi.ts` for any new or changed endpoint, so `npm run dev:frontend-only` keeps working.
- Add new endpoints to `openapi/document.ts`, and keep `openapi.test.ts` green.
- Migrations only add tables, columns or settings rows.
- From `afrinov-platform/`, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. For backend changes, also run `npm run test:integration`.
- Check the field map above and mark what the phase closed.

File references are relative to `afrinov-platform/apps/`.
