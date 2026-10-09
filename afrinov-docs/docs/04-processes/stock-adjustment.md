# Process: Stock Adjustment

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

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
3. `POST /api/v1/inventory-adjustments` (`adjust:inventory`) →
   `InventoryService.adjust`: material and location must be active; a
   negative adjustment may not take the balance below zero; one ADJUSTMENT
   row is inserted and the balance recomputed. No audit-log entry is
   written (the ledger row records the actor).

## Steps — stock count (implemented process)
1. Stock count page (`/stock/count`): choose a location; the page shows the
   system quantity of each item there; enter the counted quantities.
2. `POST /api/v1/stock-counts` (`adjust:inventory`) →
   `StockCountService.post`: one count per location at a time (database
   lock); if any shown quantity no longer matches the balance, the whole
   count is refused (409) and the counter reloads; otherwise each
   difference becomes an ADJUSTMENT with reason COUNT_VARIANCE, all
   sharing one count id (`reference_type = 'StockCount'`), and a
   `STOCK_COUNT` audit entry is written. Items counted equal to the system
   get no row.

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
- Stock can never go below zero; there is no override.
- Large adjustments requiring a second approver: **Planned** / open
  question — not implemented, threshold not decided.

## Outputs
InventoryTransaction(s) (ADJUSTMENT, or the reversal), updated
InventoryBalance, audit entry for counts and reversals.

## Open question for the business
Should scrap sale eventually be modelled as an Adjustment (stock out) linked
to a revenue event in a future Finance integration? (See
`01-product/product-scope.md`, "future" items.)

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:27-33,46-54,62-64,107-130,159-170`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:180-287,497-536`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-count.service.ts:38-114`
- `afrinov-platform/apps/frontend/src/pages/StockCount.tsx`, `afrinov-platform/apps/frontend/src/components/StockActionForm.tsx:81`, `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx:89`
