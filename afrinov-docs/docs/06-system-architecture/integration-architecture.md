# Integration Architecture

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## v1 — no live external integrations
The system is self-contained. Suppliers are contacted outside the system
(as today); there is no accounting or ERP system to integrate with. Two
file-based exchanges exist:

- **Excel and PDF downloads.** Reports can be downloaded as `.xlsx`
  (inventory report, re-order list, stock used, month-end report) and the
  inventory report also as `.pdf`, built on the server with `exceljs` and
  `pdfkit` (see `08-api/resource-model.md`).
- **Workbook import (one-off).** The command-line tool
  `npm run import:workbook` reads the stock workbook (`.xlsm`), checks it
  against reviewed mapping files and, with `--apply`, loads items,
  locations, projects, recipients, suppliers and opening balances. See
  `07-data/migration-strategy.md`.

## Internal integration (cross-module)
Modules call each other's services and read each other's tables directly,
inside one Prisma transaction where consistency is required. For example,
posting a goods receipt (`InventoryService.postGoodsReceipt`) inserts the
RECEIPT rows, increments the purchase-order lines' received quantities and
moves the order to PARTIALLY_RECEIVED or RECEIVED in the same transaction.

An in-process domain-event dispatcher exists (`shared/events.ts`) and
services dispatch events such as `InventoryIssued` and `GoodsReceived`,
but no handler is registered, so dispatching has no effect today
(TD-007). Asynchronous side effects are **Planned**; none exist.

## Future integration candidates
- **Finance/GL** — stock valuation export or GL posting on issue/receipt.
- **Document storage** — attach scanned delivery notes/invoices to Goods
  Receipts (today `GoodsReceipt.deliveryRef` is free text).
- **Email** — send a formatted PO to a supplier directly from the system.

None of these are built.

## Evidence
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.routes.ts:66-198` — export endpoints
- `afrinov-platform/apps/backend/package.json:32,34` — `exceljs`, `pdfkit`
- `afrinov-platform/apps/backend/scripts/import-workbook.ts:1-18`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:542-624` — goods receipt posting updates the PO in the same transaction
- `afrinov-platform/apps/backend/src/shared/events.ts:20-38` — dispatcher; no `registerDomainEventHandler` call exists elsewhere in `src/`
