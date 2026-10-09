# Gap Analysis: AS-IS vs TO-BE

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Current (AS-IS) | Problem | Target (TO-BE) | Status in platform |
|---|---|---|---|
| `Current Stock` is a hand-typed cell | Can silently diverge from actual movement history; no way to detect or explain drift | `InventoryBalance` derived from summed `InventoryTransaction` rows | Implemented |
| Location free text (`Store`, `Stores`, `STOREROOM`, `Storeroom`, `Store room `, `store room`, ...) | Same physical place counted as multiple locations; breaks any "stock by location" report | Normalised `Location` master, migration cleansing maps variants to one canonical row | Implemented: Location master; import maps each spelling by hand in `mapping.xlsx` |
| Supplier free text (`Hydroscand`, `Hydroscand `, etc. — inconsistent trailing spaces observed) | No supplier history, no way to compare suppliers, no spend visibility | `Supplier` master, transactions reference it by ID | Partly: Supplier master; receipts reference it; no spend report |
| No Purchase Order concept | Ordering is informal; no visibility into what's already on order before reordering again | `PurchaseOrder` + `PurchaseOrderLine`, lifecycle tracked to receipt | Implemented, off by default (`PROCUREMENT_ENABLED`) |
| Five near-identical sheet families per category | Every change (new column, new report) must be repeated five times; drift between categories is inevitable | One `Material` schema with `category`, one transaction ledger, category as a filter not a fork | Implemented |
| `Required Stock` is a silent threshold | Nobody is alerted; relies on someone noticing a rack looks empty | Active reorder alerting (FR-INV-007) | Implemented in product (status, re-order list); no push alerts |
| No user accounts | Anyone with the file can edit anything; `Issued By`/`Issued To` are unverified free text | Authenticated users, role-based permissions, actor recorded on every transaction | Implemented; Issued To is a Recipients list (ADR-008) |
| No audit trail | Cannot answer "who changed this and why" | Immutable transaction ledger + audit log (`07-data/audit-model.md`) | Implemented with gaps (TD-006, TD-008) |
| Tools tracked via a `Check In/Out` column, easy to leave inconsistent | Can't reliably answer "who currently has this tool" | Explicit Tool state machine (`03-domain/state-machines.md`) | **Planned** |
| Dashboard manually refreshed via dropdown selectors | Point-in-time snapshot, not live; requires opening the file | Live reporting views computed from the ledger | Implemented (dashboard, reports, month-end) |
| Office equipment (`Office Device List`) mixed into the same workbook family conceptually, but structurally different (no IN/OUT) | Blurs inventory (consumed) with fixed assets (owned, assigned, insured) | Explicitly out of scope for v1; candidate separate Asset Management module | Out of scope (not built) |

*Unverified:* the AS-IS column describes the July workbook, which is not in
the repository.

## Priority
The highest-value gap to close first is **balance-from-transactions**
(ADR-002) and **location normalisation** (ADR-003) — both are structural
problems that get worse the longer they're left, and both block reliable
reporting, which is the thing the business actually looks at day to day.
Both are now implemented; the remaining structural gap is tool tracking.

## Evidence
- `afrinov-platform/apps/backend/src/shared/inventory/balances.ts:6-21`
- `afrinov-platform/apps/backend/prisma/schema.prisma:133-184`
- `afrinov-platform/apps/backend/src/modules/migration/mapping.ts:1-8`
- `afrinov-platform/apps/backend/src/shared/config.ts:84-86`
