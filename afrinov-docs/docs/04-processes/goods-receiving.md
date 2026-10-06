# Process: Goods Receiving

## Inputs
Delivery from a supplier; optionally an open Purchase Order; a delivery
note or invoice reference (mirrors today's `Delivery/Invoice No.` field,
e.g. `Tax Invoice - E127076`).

## Actors
Store Controller (or whoever is on shift to receive — today, any of the 52
employees could be `Issued By`/effectively the receiver).

## Preconditions
None strictly required (ad hoc receipt is allowed, per current practice) —
but the system should nudge toward matching an open PO where one exists.

## Steps
1. Select or search for the PO (if any); or start a blank/ad hoc receipt.
2. Enter/confirm supplier.
3. Enter delivery/invoice reference.
4. For each item: select material, location it will be stored at, quantity
   received.
5. Submit → system posts InventoryTransaction(s) of type Receipt, updates
   InventoryBalance, and (if PO-linked) raises `GoodsReceived` for
   Procurement to update the PO.

## Business rules
- Quantity received need not equal quantity ordered (partial delivery is
  normal).
- Once posted, a receipt is immutable (state machine: DRAFT → SUBMITTED →
  POSTED, see `03-domain/state-machines.md`); mistakes are corrected via a
  Stock Adjustment, not by editing the receipt.

## Exceptions
- Duplicate delivery note number → warn, don't block (suppliers do
  occasionally re-send documents); leave the call to the receiving user.
- Material not yet in the Material master → must be created first (or
  created inline by an authorised user), matching how new items currently
  just get a new row added to a `Main` sheet.

## Outputs
GoodsReceipt (+ lines), InventoryTransaction(s), updated InventoryBalance,
updated PurchaseOrder (if linked).
