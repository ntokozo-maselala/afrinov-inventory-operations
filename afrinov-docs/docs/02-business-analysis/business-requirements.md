# Business Requirements

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Written in business language, independent of implementation.

**BR-001** The organisation must be able to determine the current on-hand
quantity of any material, at any location, at any time.
*Status:* Implemented — balances per material and location (`/reports/current-stock`, Stock page).

**BR-002** The organisation must be able to determine why a current
quantity is what it is (full movement history), not just what it is.
*Status:* Implemented — the ledger with actor, time, type and reference (`/inventory-transactions`, Movements page).

**BR-003** The organisation must be able to record the receipt of purchased
goods against a supplier, with a reference to the supplier's delivery or
invoice document.
*Status:* Implemented — counter receipts with supplier and delivery/invoice number; PO receipts when procurement is on.

**BR-004** The organisation must be able to record material or tools issued
to an employee, optionally against a client project.
*Status:* Implemented — issued to a recipient (a worker, machine, site or contractor; ADR-008), optionally against a project. Tools are issued like other material.

**BR-005** The organisation must be able to transfer stock between
locations without it appearing as a loss or gain.
*Status:* Implemented — linked transfer pair.

**BR-006** The organisation must be able to correct stock counts (damage,
loss, count variance) with a recorded reason.
*Status:* Implemented — adjustments with a reason code; stock counts; reversals.

**BR-007** The organisation must be alerted when a material's stock falls
below its required threshold.
*Status:* Implemented as in-product status (URGENT/WARNING) and a re-order list; no push notifications.

**BR-008** The organisation must be able to track which tools are currently
checked out, and to whom.
*Status:* **Planned** — no tool check-out tracking exists.

**BR-009** The organisation must be able to report stock value and
movement, per category and overall.
*Status:* Implemented — stock value per category, month-end report, movement history.

**BR-010** The organisation must be able to report material and tool
consumption per client project.
*Status:* Implemented — stock used by project and project-consumption report.

**BR-011** The organisation must restrict who can perform which stock
operations (issue vs. adjust vs. approve a purchase order).
*Status:* Implemented — role-based permissions checked on the server.

**BR-012** The organisation must retain a complete, unalterable audit trail
of who changed inventory data and when.
*Status:* Partly implemented — the ledger is append-only; the audit log misses some actions and is not protected at database level (TD-006, TD-008).

**BR-013** The organisation must be able to manage a list of approved
suppliers rather than re-typing supplier names per transaction.
*Status:* Partly implemented — create and select suppliers; no edit/deactivate (TD-013).

**BR-014** The organisation must be able to track purchase orders from
creation through to receipt.
*Status:* Implemented behind `PROCUREMENT_ENABLED` (off by default).

Implementation status is traced to code and tests in
`requirements-traceability-matrix.md` and `11-testing/test-traceability.md`.
*Unverified:* the requirements themselves are pending the business owner's
Milestone 0 review.
