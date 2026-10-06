# Technical Debt Register

| ID | Description | Impact | Status |
|---|---|---|---|
| TD-001 | Location/Supplier free-text cleansing during migration is manual review, not fully automatable — some ambiguous cases (e.g. "Blue Trunk (Stores)") need a business decision | Delays migration sign-off | Open |
| TD-002 | `Sheet1` (836 rows) and `Consumables Box`/`Consumables Tracking Main` overlap with `Consumables Main` is not yet understood — needs source clarification before migration mapping is finalised | Blocks migration completeness | Open |
| TD-003 | No confirmed approval-rule requirement for Purchase Orders — `APPROVED` state exists in the model but its trigger conditions are undefined | Blocks Procurement UI finalisation | Open |

Log here rather than silently deferring — this register is reviewed at each
milestone gate (`01-product/product-roadmap.md`).
