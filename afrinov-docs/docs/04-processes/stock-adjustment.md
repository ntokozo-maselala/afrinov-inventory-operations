# Process: Stock Adjustment

## Inputs
A discovered discrepancy: physical count doesn't match system balance,
damage, loss, or scrap.

## Note on AS-IS
The closest analogue today is the `Scrap Material` sheet (tracking Mild
Steel, Stainless Steel, Copper, Brass, Aluminium, Machine Shop Shavings sold
by weight/value) — but it is disconnected from the inventory balance
entirely; scrapping a fabricated offcut doesn't reduce any `Current Stock`
cell today.

## Steps
1. Select material and location.
2. Enter adjustment quantity (positive or negative) and a mandatory reason
   code (Count Variance, Damage, Loss, Scrap, Other).
3. Submit → InventoryTransaction (type Adjustment) created; balance updated.

## Business rules
- Reason is mandatory — an adjustment without a reason is not permitted
  (this directly closes the "why is the balance what it is" gap, BR-002).
- Large adjustments (threshold TBD with business) may require a second
  approver — flagged as an open question, not decided here.

## Outputs
InventoryTransaction (Adjustment), updated InventoryBalance.

## Open question for the business
Should scrap sale eventually be modelled as an Adjustment (stock out) linked
to a revenue event in a future Finance integration, rather than living in an
entirely separate, disconnected sheet as it does today? (See
`01-product/product-scope.md`, "future" items.)
