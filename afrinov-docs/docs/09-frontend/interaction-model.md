# Interaction Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

- **Issue/receive flows are built for speed at the store counter:** one
  entry carries several items; items are found by name, code or location
  with a search-as-you-type select (`SearchSelect`); the project is optional. *Unverified:*
  touch-friendliness on shop-floor devices has not been tested.
- **Errors are specific and actionable**, using the API's message (e.g.
  "Cannot issue <requested> × <SKU>: only <available> available."), per
  `08-api/error-model.md`.
  The location name is not part of the message.
- **Stock counts guard against stale numbers:** if stock at the location
  moved while counting, posting is refused and the counter is told to
  reload.
- **Destructive or ledger-changing actions confirm first** (reversal needs
  a reason; deletion and archiving use a confirm dialog).
- **Duplicate prevention in master data:** exact duplicates are refused by
  the server (supplier and recipient names ignoring case; location names;
  SKUs; codes). A "did you mean...?" prompt for near-duplicates (e.g.
  "Storeroom" vs "STOREROOM" as different spellings) is **Planned**.

## Evidence
- `afrinov-platform/apps/frontend/src/pages/IssueStock.tsx`, `afrinov-platform/apps/frontend/src/pages/ReceiveStock.tsx`
- `afrinov-platform/apps/frontend/src/components/SearchSelect.tsx`
- `afrinov-platform/apps/backend/src/modules/inventory/stock-count.service.ts:67-72`
- `afrinov-platform/apps/frontend/src/components/TransactionDrawer.tsx:89`, `afrinov-platform/apps/frontend/src/components/ConfirmDialog.tsx`
- `afrinov-platform/apps/backend/src/modules/inventory/location.service.ts:49-56`, `afrinov-platform/apps/backend/src/modules/operations/recipient.service.ts:26-40`
