# System Context

```
                 AFRINOV USERS (Store Controller, Technicians,
                  Procurement, Project Leads, Management)
                              |
                              v
                  AFRINOV INVENTORY & OPERATIONS PLATFORM
                              |
      +------------------+----+----+------------------+
      |                  |         |                  |
  Procurement         Inventory  Operations        Reporting
      |                  |         (reference)         |
      +------------------+----+----+------------------+
                              |
                          PostgreSQL
                              |
                 Future: Finance / Sales / external
                        integrations
```

## External systems (v1)
None required for v1 — this platform is self-contained, replacing standalone
Excel workbooks. No live integration exists today (suppliers are contacted
outside the system; no accounting system integration).

## Future integration points
Finance (stock valuation / GL posting), a document store for scanned
delivery notes/invoices (`06-system-architecture`'s future Document
Management context).
