# Stakeholder Map

| Stakeholder | Role today (AS-IS) | Goals | Pain points | System needs |
|---|---|---|---|---|
| Business owner ("your boss") | Sets direction, reviewed the first prototype | Wants inventory understood as a piece of a larger operational system, not a standalone app | First version modelled the spreadsheet too literally | Architecture that visibly maps to business processes; ability to validate scope before build |
| Store/inventory controller | Maintains the workbooks day to day | Accurate, fast stock lookups; less manual reconciliation | Multiple sheets per category to keep in sync; manual `Current Stock` edits drift from reality | Single source of truth; automatic balance derivation; low-stock alerts |
| Workshop floor staff (52 named in `Employees`) | Issue/receive/check out stock, recorded as `Issued By`/`Issued To` | Get material or tools quickly without paperwork friction | — | Fast issue/receive screens, usable on the shop floor |
| Project leads | Consume material against `AFRI-####` project numbers | Know what's been used against their project | Project cost of materials not easily summarised today | Reporting by project number |
| Procurement/buyer (implicit — no dedicated sheet today) | Places orders with suppliers (`JHB Bolts`, `Hydroscand`, `SIEVERT`, etc.) informally | Buy the right quantity at the right time | No supplier master, no PO tracking, no visibility into what's already on order | Supplier master, PO lifecycle, goods receipt matching |
| Finance (future) | Not currently integrated | Know stock value, cost of materials issued to projects | Stock value only appears as a Dashboard/Stock Summary figure with no breakdown by transaction | Stock valuation reporting (future integration point) |
| IT/Engineering (you) | Building and maintaining the system | Deliver a system that matches business intent, not just the old spreadsheet's shape | Ambiguous requirement ("study SAP") | Clear domain model and architecture docs (this set) |
| Suppliers (external) | Deliver goods against orders | Get paid, be asked for the right quantities | No formal PO issued to them today (informal ordering) | Out of scope for v1 UI access; referenced as master data only |
