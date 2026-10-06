# Architecture Overview

## Style
**Modular monolith.** One deployable application, internally organised into
modules that mirror the bounded contexts in `03-domain/bounded-contexts.md`
(Procurement, Inventory, Operations, Reporting, Identity & Access). This is
the right choice at Afrinov's scale (per ADR-001): it avoids the
operational overhead of microservices while still enforcing the domain
boundaries that matter for the "piece of the puzzle" scope decision.

## Layers within each module
```
HTTP layer (routes/controllers)
        |
Application layer (use cases / services — orchestrates a business transaction)
        |
Domain layer (entities, aggregates, business rules — no framework dependencies)
        |
Persistence layer (repositories — talk to the database)
```

## Cross-cutting
Authentication/authorization, audit logging, and domain-event dispatch are
shared infrastructure used by every module, not owned by any one of them —
see `module-architecture.md`.

## Why not microservices (yet)
No team-scaling or independent-deployment pressure exists today; splitting
now would add distributed-systems complexity (network calls, eventual
consistency, service discovery) to solve a problem Afrinov doesn't have.
The module boundaries are deliberately drawn so that a future split (e.g.
Reporting as its own service) is possible without a full redesign.
