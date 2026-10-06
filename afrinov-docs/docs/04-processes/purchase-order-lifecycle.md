# Process: Purchase Order Lifecycle

## States
`DRAFT → SUBMITTED → APPROVED → SENT → PARTIALLY_RECEIVED → FULLY_RECEIVED → CLOSED`,
with `CANCELLED` and `REJECTED` exits (see `03-domain/state-machines.md`).

## Steps
1. Draft: creator adds supplier and material lines/quantities, edits freely.
2. Submit: locks line edits, moves to review (if approval rule is in
   effect — TBD with business, since no approval concept exists today).
3. Approve: authorised approver signs off.
4. Send: marks as communicated to supplier (external action, e.g. email —
   not automated in v1).
5. Receive: one or more Goods Receipts post against it, moving it through
   PARTIALLY_RECEIVED to FULLY_RECEIVED.
6. Close: manual or automatic finalisation after full receipt.

## Business rules
- Only DRAFT POs are editable.
- A PO can be cancelled any time before it is fully received.
- Received quantity per line is always ≤ ordered quantity unless an
  authorised over-receipt override is used (rare; logged distinctly).

## Outputs
PurchaseOrder record with full state history, driving Goods Receipt
matching in `goods-receiving.md`.
