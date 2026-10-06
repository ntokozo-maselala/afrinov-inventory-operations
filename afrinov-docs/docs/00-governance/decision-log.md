# Architecture & Product Decision Log

Each entry is an immutable record. Once accepted, don't edit — supersede with
a new ADR and link back.

---

### ADR-001 — Treat inventory as one bounded domain within a larger operations platform
**Date:** 2026-09-01 · **Status:** Accepted

**Context:** The first build was a standalone inventory application (items,
suppliers, POs, reports, documents, settings, dashboard) mirroring the
existing Excel system. Direction from the business owner is to model the
system the way SAP models enterprise resource planning — inventory as one
module among several, not the whole product.

**Decision:** Adopt a modular-monolith architecture with explicit bounded
contexts (`Procurement`, `Inventory`, `Operations`, `Reporting`,
`Identity & Access`, `Document Management`), see `03-domain/bounded-contexts.md`.

**Alternatives considered:** (1) Keep it a standalone inventory app.
(2) Build a full multi-module ERP immediately. (3) Modular platform, inventory
module first — **chosen**, because it satisfies the stated direction without
committing to features (finance, payroll, CRM) the business hasn't asked for.

**Consequences:** Slower initial delivery; every new page must be justified
against a business capability, not added ad hoc.

---

### ADR-002 — Model stock as an append-only transaction ledger, not a mutable quantity field
**Date:** 2026-09-01 · **Status:** Accepted

**Context:** Every existing `*Main` sheet (e.g. `Fasteners, Slugs & Insluation M`,
`Consumables Main`, `Project Material Main`) stores `Current Stock` as
`Brought Forward + IN - OUT`, edited directly, with a separate `*Issued` sheet
logging individual movements. The two can and do drift apart because nothing
enforces that the master row reflects the sum of its movements.

**Decision:** `InventoryBalance` becomes a derived/materialized view over an
immutable `InventoryTransaction` ledger. No code path may write to a balance
directly.

**Consequences:** Every stock change becomes traceable to a transaction, user,
timestamp, and reference document (delivery note, project number) — closing
the biggest gap identified in `02-business-analysis/gap-analysis.md`.

---

### ADR-003 — Normalise locations instead of keeping free-text rack labels
**Date:** 2026-09-01 · **Status:** Accepted

**Context:** The workbook's `Location` column mixes rack codes (`D-1`, `F-7`,
`N-1`), free text (`Boiler Shop`, `machine shop`, `up stairs`), and typos
(`Store`, `Stores`, `STOREROOM`, `Storeroom`, `Store room `) for what is
almost certainly the same physical place.

**Decision:** Introduce a `Location` master table (see
`03-domain/entity-catalog.md`) with a canonical name and type
(`rack`, `shop-floor area`, `storeroom`, `container`, `off-site`), and migrate
free text into it during import, flagging ambiguous matches for manual review
rather than auto-merging.

**Consequences:** One-time cleansing effort during migration; all future
location references become a foreign key, not a string.

---

### ADR-004 — Keep the five existing material categories as `Material.category`, not five separate schemas
**Date:** 2026-09-01 · **Status:** Accepted

**Context:** The workbook maintains parallel, near-identical sheet families
for five categories: Fasteners/Slugs/Insulation, Tooling/PPE/Electrical,
Project Material, Consumables, and Tools — each with its own `Main`,
`Issued`, `Stock Report`, and `Stock Summary` sheet, duplicating the same
columns five times.

**Decision:** One `Material` table with a `category` attribute and one
`InventoryTransaction` table for all movements. Category-specific reporting
is a filtered view, not a separate schema.

**Consequences:** Removes structural duplication; category-specific business
rules (e.g. PPE may need expiry/certification tracking, Tools may need
check-out/check-in-by-person tracking) become attributes or extensions, not
forked tables.

---

*(Add new ADRs below this line as decisions are made. Do not renumber or delete prior entries.)*
