# Business Capability Map

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

```
                         AFRINOV OPERATIONS
                                |
        +------------------+---+---+------------------+
        |                  |       |                  |
   PROCUREMENT          INVENTORY            OPERATIONS
        |                  |                     |
   Supplier mgmt      Material master      Project reference
   Purchase orders    Location mgmt        Workshop consumption
   Goods receipt      Stock balances       Tool check-out/in
                       Stock movements
                       Reorder alerts
        |                  |                     |
        +---------+--------+---------------------+
                  |
              REPORTING
                  |
              MANAGEMENT
```

## Capability classification
| Capability | Class | v1? | Implementation status |
|---|---|---|---|
| Material master management | Core | Yes | Implemented |
| Location master management | Core | Yes | Implemented (no merge tooling) |
| Supplier master management | Core | Yes | Partly (create only) |
| Purchase order management | Core | Yes | Implemented, off by default |
| Goods receipt | Core | Yes | Implemented |
| Stock issue | Core | Yes | Implemented |
| Stock transfer | Core | Yes | Implemented |
| Stock adjustment | Core | Yes | Implemented (plus stock counts, reversals) |
| Tool check-out/in | Core (category-specific) | Yes | **Planned** |
| Reorder alerting | Supporting | Yes | Implemented (in-product) |
| Reporting & analytics | Supporting | Yes | Implemented |
| Project consumption reference | Supporting | Yes | Implemented (projects are a full master) |
| User/role administration | Supporting | Yes | Implemented (roles fixed in code) |
| Document management | Supporting | Future | Not built |
| Fixed asset / office equipment register | Strategic (adjacent) | Future | Not built |
| Scrap sales tracking | Strategic (adjacent) | Future | Not built |
| Finance/GL integration | Strategic | Future | Not built |
| Full project management | External / not this system | Future or never | Not built |
| Payroll/HR | External | Never (this system) | Not built |

Status per `03-domain/business-transactions.md` and
`02-business-analysis/requirements-traceability-matrix.md`. Recipients
("Issued To", ADR-008), racks and month-end reporting are implemented
capabilities not listed in the map above.
