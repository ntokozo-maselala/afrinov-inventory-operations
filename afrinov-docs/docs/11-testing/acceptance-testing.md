# Acceptance Testing

Written in Given/When/Then, directly from `02-business-analysis/business-requirements.md`.

**Scenario: Insufficient balance blocks an issue (BR-004, BR-009)**
```
Given material "M16X40 8.8 BLACK HEX SET SCREW" has a balance of 12 at location D-1
When a user attempts to issue 20 units from D-1
Then the request is rejected with INSUFFICIENT_BALANCE
And no InventoryTransaction is created
And the balance remains 12
```

**Scenario: Goods receipt updates PO status (BR-014)**
```
Given an open PurchaseOrder with one line for 100 units of a material
When a GoodsReceipt for 60 units is posted against that PO
Then the PO line's received_qty is 60
And the PO status is PARTIALLY_RECEIVED
And the material's InventoryBalance increases by 60
```

**Scenario: Adjustment requires a reason (BR-006)**
```
Given a material with a balance of 50
When a user submits a Stock Adjustment of -5 with no reason code
Then the request is rejected with VALIDATION_ERROR
```

Add one scenario per Business Requirement as each is implemented.
