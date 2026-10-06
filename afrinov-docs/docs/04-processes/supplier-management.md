# Process: Supplier Management

## Inputs
A new supplier to buy from, or an update to an existing one.

## Note on AS-IS
No supplier master exists — `Supplier Name` is retyped per transaction
(e.g. `Hydroscand` appears with inconsistent trailing whitespace across
rows), which is why supplier-level reporting (spend by supplier, delivery
reliability) is not possible today.

## Steps
1. Create supplier record: name, contact details.
2. Supplier becomes selectable on Purchase Orders and ad hoc Goods Receipts.
3. Update/deactivate as relationships change.

## Business rules
- Supplier name should be unique (case/whitespace-insensitive) to prevent
  the free-text duplication problem recurring in the new system.

## Outputs
Supplier record, available for PO and receipt selection.
