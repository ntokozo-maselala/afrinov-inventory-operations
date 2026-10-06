# Integration Architecture

## v1 — no external integrations
The system is self-contained. Suppliers are contacted outside the system
(as today); there is no accounting or ERP system to integrate with yet.

## Internal integration (cross-module)
In-process domain events (`03-domain/domain-events.md`) dispatched
synchronously within the same request/transaction where consistency is
required (e.g. `GoodsReceived` must update the PO before the request
returns), and asynchronously where it's a pure side-effect (e.g. Reporting
cache invalidation).

## Future integration candidates
- **Finance/GL** — stock valuation export or GL posting on issue/receipt.
- **Document storage** — attach scanned delivery notes/invoices to Goods
  Receipts (replacing the free-text `Delivery/Invoice No.` reference with an
  actual attached document).
- **Email** — send a formatted PO to a supplier directly from the system,
  removing the current manual step.

None of these are built in v1; this section exists so the architecture
doesn't accidentally foreclose them (e.g. `GoodsReceipt` already has a
structured reference field a document attachment can hang off later).
