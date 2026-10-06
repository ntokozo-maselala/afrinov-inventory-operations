# Module Architecture

```
src/
├── modules/
│   ├── identity/          # users, roles, permissions, sessions
│   ├── suppliers/         # supplier master
│   ├── procurement/       # purchase orders, PO lines
│   ├── inventory/         # materials, locations, transactions, balances
│   ├── operations/        # project reference data
│   ├── documents/         # (future) delivery notes, invoices as attachments
│   └── reporting/         # read-only cross-module views
│
├── shared/
│   ├── database/          # connection, migration tooling
│   ├── errors/            # standard error types
│   ├── logging/
│   ├── validation/
│   ├── events/            # in-process domain event dispatcher
│   └── authorization/     # permission-check middleware
│
└── infrastructure/
    ├── http/               # server bootstrap, route registration
    └── config/
```

## Module boundary rule
A module may depend on another module's **public interface** (a small,
explicit set of exported functions/types) but never reaches into another
module's internal repositories or database tables directly. `reporting`
depends on read-only query interfaces exposed by `inventory` and
`procurement`; it owns no write path.

## Comparison to the current codebase shape (if applicable)
If the existing prototype used a flat `controllers/services/models/routes`
structure, that layout mixed every category (fasteners, tools, consumables,
etc.) together without a domain seam — this module structure replaces that
with domain-first organisation, per `product-principles.md` rule 1.
