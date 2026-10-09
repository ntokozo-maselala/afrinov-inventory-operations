# Acceptance Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Written in Given/When/Then, directly from
`02-business-analysis/business-requirements.md`. Each scenario names the
automated test that checks it.

**Scenario: Insufficient balance blocks an issue (BR-004, BR-009)**
```
Given a material has a balance of 12 at a location
When a user attempts to issue 20 units from that location
Then the request is rejected with INSUFFICIENT_BALANCE
And no InventoryTransaction is created
And the balance remains 12
```
Automated by: `integration/inventory.real-http.test.ts` ("never lets an
issue or a write-off take stock below zero"); unit tests in
`src/modules/inventory/inventory.service.test.ts`.

**Scenario: Goods receipt updates PO status (BR-014)**
```
Given an approved PurchaseOrder with one line for 100 units of a material
When a GoodsReceipt for 60 units is posted against that PO
Then the PO line's received quantity is 60
And the PO status is PARTIALLY_RECEIVED
And the material's InventoryBalance increases by 60
```
Automated by: `integration/procurement.real-http.test.ts` ("posting a
receipt adds its quantity to stock and part-receives the order"). Needs
`PROCUREMENT_ENABLED=true`. The order must be APPROVED (or already
PARTIALLY_RECEIVED), not merely "open".

**Scenario: Adjustment requires a reason (BR-006)**
```
Given a material with a balance of 50
When a user submits a Stock Adjustment of -5 with no reason code
Then the request is rejected with VALIDATION_ERROR
```
Automated by: `src/modules/inventory/inventory.routes.test.ts` (400 for an
invalid reason code); a missing reason code fails the same request schema.

Add one scenario per Business Requirement as each is implemented.

## Evidence
- `afrinov-platform/apps/backend/integration/inventory.real-http.test.ts:153-168`
- `afrinov-platform/apps/backend/integration/procurement.real-http.test.ts:118-133`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.test.ts:260`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.ts:27-33`
