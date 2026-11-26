<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-05-007</b></td>
<td align="center"><b><i>SAP Procurement Model — What Was Studied</i></b><br><i>SAP Study</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-05-007 updated=2026-11-26 by="Ntokozo Maselala" body=1bb52577cf7a -->

# SAP Procurement Model — What Was Studied

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

SAP's procurement chain: **Purchase Requisition** (internal ask) →
**Purchase Order** (external commitment) → **Goods Receipt** (physical
confirmation) → **Invoice Receipt** (financial confirmation) → **Payment**.

Afrinov adopts the middle of this chain — **PO → Goods Receipt** — because:
- No internal requisition/approval-request layer exists in the current
  business process (buying is currently informal and immediate); adding a
  requisition step now would be process invention, not digitisation.
- Invoice receipt and payment are Finance's domain, explicitly out of scope
  (`product-scope.md`).

SAP's **Vendor/Business Partner** concept (a vendor can be a customer too,
have multiple addresses, bank details, tax info) is simplified to a plain
`Supplier` record with name and contact details — Afrinov has no evidence
of needing more than that today.
