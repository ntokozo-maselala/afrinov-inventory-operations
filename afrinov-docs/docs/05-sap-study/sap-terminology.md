# SAP Terminology Reference

| SAP term | Meaning | Afrinov mapping |
|---|---|---|
| Material Master | Central record for anything the company stocks or buys | `Material` |
| Vendor / Business Partner | External party the company transacts with | `Supplier` |
| Plant | A physical/organisational production or storage site | Simplified to a single implicit "site" for Afrinov (one workshop) |
| Storage Location | A sub-division of a Plant where stock is kept | `Location` (rack, storeroom, shop area) |
| Purchase Requisition | An internal request to buy something, before a PO exists | Not adopted in v1 — Afrinov's reorder alert goes straight to PO drafting |
| Purchase Order | A formal order to a vendor | `PurchaseOrder` |
| Goods Receipt (MIGO) | Posting the physical arrival of goods | `GoodsReceipt` |
| Material Document | The system record created by a goods movement | `InventoryTransaction` |
| Movement Type | A code classifying what kind of stock movement occurred (goods receipt, goods issue, transfer posting, etc.) | `InventoryTransaction.type` |
| Stock Type (unrestricted, blocked, quality inspection) | Sub-classification of on-hand stock by usability | Not adopted in v1 (see `sap-not-to-copy.md`) |
| Document Flow | The linked chain PR → PO → GR → Invoice | Simplified chain: PO → GoodsReceipt → InventoryTransaction |
