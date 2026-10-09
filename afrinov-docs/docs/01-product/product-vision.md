# Product Vision

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09 · **Validate with:** Business owner

## Problem
Afrinov currently runs inventory, tooling, PPE, consumables, and project
material tracking across a family of interlinked Excel workbooks
(`07__July_2026_Report.xlsm` and its monthly predecessors). Each material
category duplicates the same structure (Main / Issued / Stock Report / Stock
Summary sheets); stock balances are hand-edited rather than derived from
movements; locations are free text with inconsistent spelling; there is no
access control, audit trail, or single current-state view across categories.
This does not scale past one careful spreadsheet owner and is fragile: a
single bad edit silently corrupts the stock position with no way to trace
what happened.

## Why now
The business has asked to move beyond "digitise the spreadsheet" toward a
proper operations system — explicitly referencing SAP as a model for how
inventory should sit inside a larger structure of procurement and operations,
not stand alone.

## Vision statement
Give Afrinov a single, auditable, multi-user system of record for everything
that moves through its stores — fasteners, consumables, tooling, PPE, project
material — correctly modelled as part of the procurement and operations
processes that create and consume it, built to extend into adjacent domains
(finance, sales/projects) without a rewrite.

## What success looks like
- Any authorised person can answer "how much of X do we have, where, and why"
  in seconds, with full history — not by opening the right worksheet.
- Every stock change is attributable to a person, a time, and a reason
  (receipt, issue, transfer, adjustment) and cannot be silently overwritten.
- Reordering is proactive: the system flags materials below `Required Stock`
  rather than someone noticing a rack is empty.
- The five parallel category workbooks become one system with category as an
  attribute, not five copies of the same logic.
- The architecture has clear seams (bounded contexts) so Procurement, Sales,
  or Finance can be added later without redesigning Inventory.

## Non-goals (for now)
Full accounting/ledger integration, payroll, CRM, manufacturing execution,
and multi-site/multi-currency support are explicitly out of scope until the
core inventory-and-procurement loop is proven. See `product-scope.md`.
