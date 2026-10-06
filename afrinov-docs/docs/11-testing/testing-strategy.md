# Testing Strategy

Test business invariants, not just CRUD. The most important invariant in
this system: **a material's balance always equals the sum of its posted
transactions** — this should be asserted directly in tests, since its
violation was the root failure mode of the AS-IS spreadsheet.

Layers: unit (domain rules) → integration (use case + real database) → API
(HTTP contract) → end-to-end (critical user journeys) → acceptance
(business scenarios, plain language) — see `test-pyramid.md`.
