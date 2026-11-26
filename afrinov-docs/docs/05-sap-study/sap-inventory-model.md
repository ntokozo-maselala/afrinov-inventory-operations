<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-05-003</b></td>
<td align="center"><b><i>SAP Inventory Model — What Was Studied</i></b><br><i>SAP Study</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-05-003 updated=2026-11-26 by="Ntokozo Maselala" body=f0e17305c40c -->

# SAP Inventory Model — What Was Studied

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

SAP separates **Material Master** (what a thing is) from **Material
Document / Movement** (what happened to it) from **Stock** (a derived
current position). This three-way separation is the single most important
idea carried into Afrinov's domain model (`03-domain/domain-model.md`):

```
SAP:      Material Master  --(movement)-->  Material Document  --(derives)-->  Stock
Afrinov:  Material         --(transaction)-->  InventoryTransaction  --(derives)-->  InventoryBalance
```

SAP additionally separates stock by **Stock Type** (unrestricted-use,
quality-inspection, blocked) — not adopted (see `sap-not-to-copy.md`), since
Afrinov has no quality-hold workflow today.

SAP's **Movement Type** codes (101 = Goods Receipt for PO, 201 = Goods
Issue to Cost Center, 301 = Transfer Posting, etc.) are the inspiration for
Afrinov's much smaller `InventoryTransaction.type` enum — the lesson taken
is "classify every movement with a type", not "use SAP's specific codes."

*Implementation note:* the platform has six transaction types — RECEIPT,
ISSUE, TRANSFER_OUT and TRANSFER_IN (a transfer is two linked rows), ADJUSTMENT
and RETURN (stock back from an issue). Reversals reuse the original type with
the opposite sign (ADR-005). Source:
`afrinov-platform/apps/backend/prisma/schema.prisma:395-404`.
