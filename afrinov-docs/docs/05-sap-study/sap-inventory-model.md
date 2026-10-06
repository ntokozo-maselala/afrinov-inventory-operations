# SAP Inventory Model — What Was Studied

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
