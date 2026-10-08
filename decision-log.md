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

---

### ADR-005 — Correct ledger mistakes by reversal, never by editing
**Date:** 2026-10-08 · **Status:** Accepted

**Context:** ADR-002 makes the transaction ledger append-only, but an
endpoint (`PATCH /inventory-transactions/:id`) still let a store controller
change who posted a movement. People make entry mistakes; the ledger needs a
way to correct them that keeps the record trustworthy.

**Decision:** Posted transactions are never updated. A mistake is corrected
by a reversing entry: the original's type with the opposite sign, linked to
it through a unique `reverses_id`, with a mandatory reason. Both legs of a
transfer are reversed together; a reversal cannot be reversed, and cannot
take stock below zero.

**Consequences:** Every correction stays visible in the history with who
made it and why. Signed totals net reversals out on their own; summaries
that add absolute quantities by type must leave reversed pairs out.

---

### ADR-006 — Accounts are created by an administrator; no self-registration
**Date:** 2026-10-08 · **Status:** Accepted

**Context:** The platform had a sign-up page and an opt-in
`POST /auth/register` route that created read-only accounts. The system is
internal to Afrinov: everyone who uses it is known to the business.

**Decision:** Remove self-registration (route, page and the
`security.allowSelfRegistration` setting). An administrator creates accounts
and assigns roles under Settings → Users.

**Consequences:** One fewer unauthenticated endpoint. Onboarding a storeman
needs an administrator, which matches how access is controlled today.

---

### ADR-007 — Purchase orders: no shipping stage, receive then close
**Date:** 2026-10-08 · **Status:** Accepted

**Context:** The purchase-order lifecycle modelled courier shipments
(APPROVED → SHIPPED with carrier and tracking → DELIVERED) and carried six
leftover statuses (SUBMITTED, SENT, PARTIALLY_RECEIVED, FULLY_RECEIVED,
CLOSED, REJECTED) with overlapping meanings. Afrinov's suppliers are local
and deliver with an invoice. Partly delivered orders also had no way to be
finished, and goods could be received against any order.

**Decision:** Seven statuses: DRAFT → PENDING_APPROVAL → APPROVED →
PARTIALLY_RECEIVED → RECEIVED → CLOSED, or CANCELLED before anything is
received. Receiving happens through goods receipts, or "receive all
outstanding" in one step; only APPROVED and PARTIALLY_RECEIVED orders can be
received against. Closing short needs a reason. Removed statuses are mapped
by migration 20260101000004; the shipping columns stay, unused, so history is
kept.

**Consequences:** Fewer states to explain and test. A rejected order is
recorded as cancelled with a reason. Approvers cannot yet reject an order
themselves (they lack the cancel permission); revisit if procurement is used.

---

### ADR-008 — "Issued To" is a typed recipients list, required on every issue
**Date:** 2026-10-08 · **Status:** Accepted

**Context:** The workbook's "Issued To" column was free text backed by an
Employees sheet that mixed workers with machines (Forklift, Generator),
client sites (Northam, Samancor) and contractors (KTS, Kenflex). In the
platform, `recipientId` had to be a user who logs in, and the issue form did
not ask for it, so nobody was recorded as receiving stock.

**Decision:** A `Recipient` list with a type on each entry: WORKER, MACHINE,
SITE or CONTRACTOR. Names are unique ignoring case. Recipients are
deactivated, never deleted. Every issue must name an active recipient
(enforced on the issue form in Phase 1, step 2). Admins and store
controllers manage the list; anyone signed in can read it.

**Consequences:** Every issue says who received the stock, which gives the
per-worker accountability the Consumable Box sheet was attempting, and
reports can filter by recipient type.
