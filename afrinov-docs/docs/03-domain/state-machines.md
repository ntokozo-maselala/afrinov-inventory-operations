# State Machines

## Purchase Order
```
DRAFT -> SUBMITTED -> APPROVED -> SENT -> PARTIALLY_RECEIVED -> FULLY_RECEIVED -> CLOSED
                                     \
                                      -> CANCELLED (from DRAFT/SUBMITTED/APPROVED/SENT)
SUBMITTED -> REJECTED
```
Rules: only DRAFT is editable. PARTIALLY_RECEIVED is entered automatically
when a GoodsReceipt is posted against the PO with less than the full ordered
quantity; FULLY_RECEIVED when quantities match. CLOSED is a manual or
scheduled finalisation after FULLY_RECEIVED.

## Goods Receipt
```
DRAFT -> SUBMITTED -> POSTED
```
Rules: once POSTED, it is immutable (it has already created
InventoryTransactions and, if PO-linked, updated the PO). Corrections after
posting are new Adjustment transactions, never an edit to the receipt.

## Tool
```
IN_STORE -> CHECKED_OUT (to a specific User) -> IN_STORE
                |
                -> LOST / DAMAGED (terminal, requires Adjustment + reason)
```
Rules: a tool can only be checked out from `IN_STORE`; checking in requires
the current holder (or an authorised override) to confirm return condition.

## Inventory Transaction
```
(none) -> POSTED
```
Rules: transactions have no further states — they are created once, in a
final `POSTED` state, and never transition again (ADR-002). This is
intentionally the simplest state machine in the system, because mutability
is exactly the risk being designed out.
