# SAP Business Processes Studied

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Procure-to-Pay (studied, partially adopted)
`Requisition → PO → Goods Receipt → Invoice Verification → Payment`.
Afrinov adopts PO → Goods Receipt (`procure-to-stock.md`) but **not**
requisition (no approval-request layer exists yet) or invoice
verification/payment (that's Finance, out of scope — see `product-scope.md`).

## Inventory Management processes (adopted, simplified)
Goods receipt, goods issue, stock transfer, physical inventory / stock
adjustment — all map directly to Afrinov's five `04-processes/` documents
for Inventory. SAP's much larger set of movement types (100+) is reduced to
four (`Receipt`, `Issue`, `Transfer`, `Adjustment`) since Afrinov doesn't
need to distinguish, e.g., a goods issue to production order vs. a goods
issue to cost center — a single `Issue` with an optional `Project`
reference covers Afrinov's actual need.

*Implementation note:* the platform has six transaction types — RECEIPT,
ISSUE, TRANSFER_OUT and TRANSFER_IN (a transfer is two linked rows), ADJUSTMENT
and RETURN (stock back from an issue). Reversals reuse the original type with
the opposite sign (ADR-005). Source:
`afrinov-platform/apps/backend/prisma/schema.prisma:395-404`.


## Plan-to-Produce (studied, not adopted)
Manufacturing execution and production orders — Afrinov's boiler
shop/machine shop work is not modelled as formal production orders in this
system; material is issued against a project reference, which is
sufficient for the stated scope.

## Order-to-Cash (studied, not adopted)
Sales order → delivery → billing — Afrinov's "customer" side (client
projects) is referenced only, not modelled as sales orders in this system.
