# Process: Stock Transfer

## Inputs
A need to move stock from one location to another (e.g. from `Stores` to a
shop-floor rack) without it being consumed.

## Note on AS-IS
Not currently modelled as a distinct event — the spreadsheet has no
transfer-specific rows; a move between racks likely happens as an
undocumented manual edit to `Location`/`Rack`, which is exactly the kind of
change ADR-002/ADR-003 are meant to make traceable.

## Steps
1. Select material and source location.
2. Select destination location.
3. Enter quantity (≤ current balance at source).
4. Submit → system creates a linked pair of InventoryTransactions:
   Transfer-Out at source (negative), Transfer-In at destination
   (positive), same quantity, same reference id, same timestamp.

## Business rules
- Net effect on total on-hand quantity is always zero.
- Both legs post atomically — a transfer half-completed on write is a
  reliability defect (see `02-business-analysis/non-functional-requirements.md`).

## Outputs
Two linked InventoryTransactions, updated balances at both locations.
