# Contract Testing

Since the frontend is a dedicated SPA consuming this API, contract tests
(e.g. schema validation against an OpenAPI spec generated from
`08-api/resource-model.md`) catch drift between backend response shape and
frontend expectations before it reaches a user — particularly important for
the shop-floor issue/receive flows where a broken form is a real workflow
blocker, not just an inconvenience.
