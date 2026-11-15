# Process: Stock Adjustment

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** feat/writeoff-responsible, 2026-11-02

## Inputs
A discovered discrepancy: physical count doesn't match system balance,
damage, loss, or scrap — or a posting mistake that needs undoing.

## Note on AS-IS
The closest analogue today is the `Scrap Material` sheet (tracking Mild
Steel, Stainless Steel, Copper, Brass, Aluminium, Machine Shop Shavings sold
by weight/value) — but it is disconnected from the inventory balance
entirely. *Unverified* (workbook observation).

## Steps — single adjustment
1. From the Stock page (or material detail), choose Adjust: material and
   location.
2. Enter a non-zero quantity (positive or negative) and a reason code
   (COUNT_VARIANCE, DAMAGE, LOSS, SCRAP, OTHER); a note is optional.
3. For DAMAGE, LOSS and SCRAP, choose who was responsible: a recipient
   (worker, machine, site or contractor) or **Not known**. The form does not
   accept a blank choice. Naming someone makes the note required ("What
   happened"), and the form says the entry records who was involved, not
   who is at fault.
4. `POST /api/v1/inventory-adjustments` (`adjust:inventory`) →
   `InventoryService.adjust`: material and location must be active; a
   negative adjustment may not take the balance below zero; one ADJUSTMENT
   row is inserted and the balance recomputed. The responsible person is
   stored in the row's `recipient_id` (null for Not known). No audit-log
   entry is written (the ledger row records the actor).

A tool lost on loan is written off from its check-in (ADJUSTMENT, LOSS), and
the borrower is recorded as responsible automatically.

## Steps — stock count (implemented process)
1. Stock count page (`/stock/count`): choose a location and whose stock,
   Stores or one project's held there, and whether it is a **spot** count (the
   items counted) or a **full** count (everything with stock there). The sheet
   (`GET /api/v1/stock-counts/sheet`) lists every item with book stock in that
   stock and when it was opened. With **blind counts** on
   (`inventory.blindCounts`), it shows no system quantities (ADR-040).
2. `POST /api/v1/stock-counts` (`adjust:inventory`) →
   `StockCountService.post`: one count per location at a time (database
   lock). A full count is refused unless every item with stock there is on it;
   the screen offers to count blank ones as 0, once confirmed as not found. A
   line whose stock moved while counting (its shown figure no longer matches,
   or, blind, something was posted to it since the sheet opened) is **held
   back** for a recount and the rest post; only when every line moved is the
   count refused (409). Each difference becomes an ADJUSTMENT with reason
   COUNT_VARIANCE in the stock counted, all sharing one count id
   (`reference_type = 'StockCount'`), and a `STOCK_COUNT` audit entry records
   the kind, the stock and what was held back. Items counted equal to the
   system get no row.

## Steps — correcting a mistake (reversal)
1. Movements page → open the movement → Reverse, with a reason (3–500
   characters).
2. `POST /api/v1/inventory-transactions/:id/reversal`
   (`reverse:inventory_transaction`: ADMIN, STORE_CONTROLLER) posts the
   opposite entry linked to the original (ADR-005). Rules: in
   `03-domain/state-machines.md`.

## Business rules
- A reason code is mandatory on every adjustment (enforced by request
  validation); the note is optional.
- Only DAMAGE, LOSS and SCRAP may name who was responsible, and naming
  someone requires a note (400 VALIDATION_ERROR otherwise). The recipient
  must exist and be active. The API accepts a missing `recipientId` as
  Not known; the explicit choice is enforced by the form.
- A reversal keeps the responsible person, and the Write-offs totals leave
  out both a reversed write-off and its reversal.
- Recording who was responsible is a record of who was involved, not a
  finding of fault. Any follow-up, such as a deduction from pay, is a
  manager's decision and needs the person's written agreement.
- Stock can never go below zero; there is no override.
- Large adjustments requiring a second approver: **Planned** / open
  question — not implemented, threshold not decided.

## Outputs
InventoryTransaction(s) (ADJUSTMENT, or the reversal), updated
InventoryBalance, audit entry for counts and reversals.

On Movements → Write-offs and adjustments: a Responsible column and filter
(a person, or Not known), and a table of write-offs by who was responsible
with their value at unit cost (`GET
/api/v1/inventory-transactions/writeoffs-by-responsible`). Choosing a row
filters the list. The Excel and PDF downloads carry a Responsible column.

## Open question for the business
Should scrap sale eventually be modelled as an Adjustment (stock out) linked
to a revenue event in a future Finance integration? (See
`01-product/product-scope.md`, "future" items.)

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:27-33,46-54,62-64,107-130,159-170`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:180-287,497-536`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-count.service.ts:38-114`
- `afrinov-platform/apps/frontend/src/pages/StockCount.tsx`, `afrinov-platform/apps/frontend/src/components/StockActionForm.tsx`, `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx:89`
- Responsible person: `InventoryService.adjust` and `writeoffsByResponsible` in `inventory.service.ts`;
  `afrinov-platform/apps/frontend/src/components/reports/LedgerReport.tsx` (Responsible column, totals);
  `afrinov-platform/apps/backend/integration/writeoff-responsible.real-http.test.ts`
