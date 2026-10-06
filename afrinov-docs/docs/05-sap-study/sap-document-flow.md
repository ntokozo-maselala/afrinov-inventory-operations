# SAP Document Flow — What Was Studied

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
