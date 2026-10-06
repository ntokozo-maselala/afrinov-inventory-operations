# API Conventions

- Nouns for resources, verbs implied by HTTP method: `GET /materials`,
  `POST /materials`, `GET /materials/:id`, `PATCH /materials/:id`.
- Business actions that aren't plain CRUD are modelled as `POST` to a
  purpose-named sub-resource: `POST /inventory-issues`, not
  `POST /materials/:id/issue`, so the transaction itself (with its own
  actor, timestamp, and reference) is the primary resource.
- Filtering via query params: `GET /inventory-transactions?material_id=..&from=..&to=..&type=issue`.
- Pagination via `?page=&pageSize=` (or cursor-based for
  `inventory-transactions`, given expected volume).
- Dates in ISO 8601, always UTC on the wire.
- Money/quantity values as numbers with a documented unit, never as
  formatted strings.
