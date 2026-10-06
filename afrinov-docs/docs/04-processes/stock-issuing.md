# Process: Stock Issuing (and Tool Check-Out)

## Inputs
A request for material or a tool by an employee, optionally for a specific
project.

## Actors
Any authorised employee (issuer and/or recipient — today's system allows
the same person to be both `Issued By` and `Issued To`).

## Steps — Consumable/Material issue
1. Search for material.
2. Select location (default to where stock exists).
3. Enter quantity.
4. Optionally select project number (`AFRI-####`).
5. Submit → system checks `InventoryBalance ≥ quantity` at that location.
6. InventoryTransaction (type Issue, negative quantity) created; balance
   updated.

## Steps — Tool check-out
1. Search for tool.
2. Confirm it is currently `IN_STORE`.
3. Select recipient employee, optional project.
4. Submit → Tool state becomes `CHECKED_OUT`; InventoryTransaction (type
   Issue) logged for reporting consistency, holder recorded.
5. Check-in later reverses the state to `IN_STORE`.

## Business rules
- Materials: issuing more than available balance should be blocked by
  default (BR-009, proposed — not enforced today) unless an authorised
  override with a reason is used.
- Tools: cannot be checked out if already `CHECKED_OUT` to someone else —
  must be checked in first. This is new discipline the current
  `Check In/Out` column does not enforce.

## Exceptions
- Urgent need exceeding available stock → override path, logged distinctly
  so it surfaces in reporting as a stock-out event (useful signal for
  reorder thresholds being set too low).

## Outputs
InventoryTransaction(s), updated InventoryBalance, (for tools) updated
holder/state.
