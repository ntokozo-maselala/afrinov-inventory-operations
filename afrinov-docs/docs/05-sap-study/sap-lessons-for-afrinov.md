# SAP → Afrinov Mapping: What to Adopt

| SAP concept | Afrinov concept | Decision |
|---|---|---|
| Material Master | Material | Adopt |
| Vendor / Business Partner | Supplier | Simplify (name + contact only) |
| Purchase Order | PurchaseOrder | Adopt |
| Goods Receipt (MIGO) | GoodsReceipt | Adopt |
| Material Document | InventoryTransaction | Adopt the *principle* (immutable, typed movement record) |
| Movement Type | InventoryTransaction.type | Adopt the *principle*, drastically reduced set (4 types, not 100+) |
| Plant | (implicit single site) | Adopt the *concept*, not the multi-level hierarchy |
| Storage Location | Location | Adopt |
| Stock Type (unrestricted/blocked/QI) | — | Not adopted (see below) |
| Purchase Requisition | — | Not adopted (no approval-request step exists in Afrinov's current process) |
| Document Flow engine | Foreign-key reference chain | Adopt the *outcome* (traceability), simpler mechanism |
| Client/Company Code | — | Not adopted (single legal entity, single site) |

## The core principle carried forward
Separate **master data** (what things are), **transactional data** (what
happened), and **derived data** (current position) — and never let derived
data be edited directly. This single idea, more than any specific SAP
screen, is what fixes the root cause identified in
`02-business-analysis/gap-analysis.md`.
