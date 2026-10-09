# SAP Study Plan

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Goal:** understand the reference model well enough to design Afrinov's
system soundly — not to reproduce SAP's complexity (see
`sap-not-to-copy.md`).

## Study order
1. ERP concepts generally — what problem does an integrated system solve
   that isolated spreadsheets don't?
2. SAP organisational structure (Client, Company Code, Plant, Storage
   Location) — compare against Afrinov's Stores/Boiler Shop/Machine Shop/
   Blasting/Paint Shop areas.
3. Material Master — compare against the `Material` entity in
   `03-domain/entity-catalog.md`.
4. Business Partner / Vendor — compare against `Supplier`.
5. Procurement (Purchase Requisition → Purchase Order) — compare against
   `04-processes/purchase-order-lifecycle.md`.
6. Goods Receipt / Material Document — compare against
   `04-processes/goods-receiving.md` and `InventoryTransaction`.
7. Inventory Management (Movement Types, Stock Types) — compare against
   `InventoryTransaction.type`.
8. Document flow / audit — compare against `07-data/audit-model.md`.

## For each concept, record
- What problem it solves.
- Why it exists (what failure mode it prevents).
- Which Afrinov process it maps to.
- What to adopt, simplify, or explicitly skip.

Output goes into `sap-terminology.md`, `sap-lessons-for-afrinov.md`, and
`sap-not-to-copy.md`.
