# SAP Procurement Model — What Was Studied

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
