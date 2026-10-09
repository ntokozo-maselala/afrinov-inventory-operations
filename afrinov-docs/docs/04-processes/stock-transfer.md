# Process: Stock Transfer

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Inputs
A need to move stock from one location to another (e.g. from `Stores` to a
shop-floor rack) without it being consumed.

## Note on AS-IS
Not modelled as a distinct event in the workbook; a move between racks is
an undocumented manual edit to `Location`/`Rack` — exactly the change
ADR-002/ADR-003 make traceable. *Unverified* (workbook observation).

## Steps
1. From the Stock page (or material detail), choose Transfer: material and
   source location.
2. Choose a different destination location.
3. Enter a positive quantity, at most the balance at the source.
4. `POST /api/v1/inventory-transfers` (`transfer:inventory`) →
   `InventoryService.transfer`, in one transaction: material and both
   locations must be active; a TRANSFER_OUT row (negative) at the source
   and a TRANSFER_IN row (positive) at the destination are inserted, each
   pointing at the other through `paired_with_id`; both balances are
   recomputed. No audit-log entry is written.

## Business rules
- Net effect on total on-hand quantity is always zero.
- Both legs post atomically.
- A transfer is reversed as a pair (ADR-005).

## Outputs
Two linked InventoryTransactions, updated balances at both locations.

## Evidence
- `afrinov-platform/apps/frontend/src/components/StockActionForm.tsx:75`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:20-25,95-105`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:208-218,434-495`
