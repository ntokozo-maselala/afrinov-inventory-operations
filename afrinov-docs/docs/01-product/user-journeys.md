# Key User Journeys

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## 1. Technician draws material for a job
1. George needs 20x M16 bolts for project `AFRI-1325`.
2. Opens Issue screen, searches "M16", selects the fastener, location `D-1`
   defaults from where stock exists.
3. Enters quantity 20, selects project `AFRI-1325`, confirms.
4. System checks available balance ≥ 20, creates an `InventoryTransaction`
   (type: Issue), updates the derived balance, logs George as `Issued To`
   (or `Performed By`, if self-service) — mirrors today's `FS&I Issued`
   sheet, minus the risk of a bad manual edit.

*As implemented:* the storeman issues on the Issue stock page; George is
chosen from the Recipients list as "Issued To" (required), the signed-in
storeman is recorded as the actor; several items can go in one entry; the
location is picked by the user, not defaulted.

## 2. Stock arrives from a supplier
1. Delivery arrives from `Hydroscand` against invoice `E127076`.
2. Store controller opens Goods Receipt, optionally matches an open PO, or
   records ad hoc if no PO exists yet (today's reality — no PO sheet exists
   at all). *As implemented:* the Receive stock page records a counter
   receipt (supplier and invoice number required); PO matching needs
   procurement switched on.
3. Enters items and quantities from the delivery note; system creates
   Receipt transactions, updates balances, stores the invoice/delivery
   reference — same fields as today's `Delivery/Invoice No.` column, now
   structured.

## 3. Store controller notices low stock
1. Dashboard surfaces materials where `on-hand < Required Stock`
   (today: the store controller has to notice a rack looks empty).
2. Controller reviews, decides to order, creates a Purchase Order against a
   supplier from the Supplier Master.
3. PO tracked through to Received status until goods receipt closes it.
   *As implemented:* there is no "Sent" status — DRAFT → PENDING_APPROVAL →
   APPROVED → PARTIALLY_RECEIVED → RECEIVED → CLOSED (ADR-007), and only
   with procurement switched on. Today the controller downloads the re-order
   list from the Stock status page instead.

## 4. Technician checks out a tool — **Planned**
1. Vincent needs the Ryobi drill.
2. Opens Tools screen, checks it's currently "in stores", checks it out to
   himself, optionally against a project.
3. System records a Check-Out transaction; the tool shows as "with Vincent"
   until he checks it back in — replacing the `Check In/Out` column on
   `Tools Issued`, but now queryable ("what does Vincent currently have?").

*Not implemented:* there is no tool check-out; tools are issued and
returned like other material.

## 5. Manager reviews monthly position
1. Opens Reporting, filters by category and date range.
2. Sees stock value, movement summary, top/bottom stock quantities — the
   role today's Dashboard and `*Stock Summary` sheets play, but computed
   from the transaction ledger rather than maintained by hand.

*As implemented:* the Month-end report page (and Excel download) shows,
per category, stock on hand, value, status and stock used for a chosen
month; the Stock used page filters by date range, project and recipient.

*Unverified:* the names (George, Vincent) and the example items come from
the July workbook and are illustrative.

## Evidence
- `afrinov-platform/apps/frontend/src/pages/IssueStock.tsx`, `afrinov-platform/apps/frontend/src/pages/ReceiveStock.tsx`, `afrinov-platform/apps/frontend/src/pages/MonthEnd.tsx`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:10-18,35-44`
