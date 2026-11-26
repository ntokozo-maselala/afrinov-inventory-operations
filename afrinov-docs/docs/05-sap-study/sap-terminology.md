<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-05-009</b></td>
<td align="center"><b><i>SAP Terminology Reference</i></b><br><i>SAP Study</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-05-009 updated=2026-11-26 by="Ntokozo Maselala" body=8879a2b3b1ef -->

# SAP Terminology Reference

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

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
