<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-05-002</b></td>
<td align="center"><b><i>SAP Document Flow — What Was Studied</i></b><br><i>SAP Study</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-05-002 updated=2026-11-26 by="Ntokozo Maselala" body=cd4bd12147ae -->

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
