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
