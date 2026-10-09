# SAP Document Flow — What Was Studied

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

SAP maintains an explicit, queryable **document flow**: from any document
(a PO, a Material Document) you can navigate forward and backward through
everything it caused or was caused by. This is the direct inspiration for
Afrinov's traceability requirement (BR-002, BR-012): every
`InventoryTransaction` should be traceable back to its originating
`GoodsReceipt`/`PurchaseOrder`/`Project` reference, and every `PurchaseOrder`
should show which receipts were posted against it.

This does not require SAP's generalized document-flow engine — a foreign
key from `InventoryTransaction.reference` to the originating record, plus
an indexed query, achieves the same practical outcome at Afrinov's scale.

*Implementation note:* the link is a polymorphic pair
`inventory_transactions.reference_type` / `reference_id` (e.g. `GoodsReceipt`,
`Project`, `Return`, `StockCount`, `OpeningBalance`), indexed but not a
foreign key; goods receipts point at their purchase order through a real
foreign key (`purchase_order_id`), and the movement history shows each
receipt's number, supplier and delivery reference. Source:
`afrinov-platform/apps/backend/prisma/schema.prisma:422-424,367`,
`afrinov-platform/apps/backend/src/modules/inventory/inventory.service.ts:129-170`.
