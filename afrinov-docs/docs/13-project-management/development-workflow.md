# Development Workflow

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Follow the document dependency chain established in this documentation set:

```
Business Context -> AS-IS/TO-BE -> Business Requirements -> Domain Model ->
SAP Study/Mapping -> Architecture -> Data Model -> API -> UI -> Implementation
-> Testing -> Deployment -> Operations
```

Do not start a module's implementation before its entry in `03-domain/` and
`04-processes/` exists and has been reviewed — this is the concrete
practice that prevents repeating the original mistake (building UI before
the business model was understood).

*Unverified* as current practice: implementation now follows the phases in
`workbook-replacement-roadmap.md` (repository root), and several modules
(recipients, returns, stock counts, month-end) were built before their
`03-domain/` and `04-processes/` entries existed; those entries were added
in the 2026-10-09 documentation reconciliation.
