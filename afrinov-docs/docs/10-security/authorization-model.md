# Authorization Model

Permission = (action, resource-type), e.g. `create:purchase_order`,
`approve:purchase_order`, `issue:inventory`. Roles are named bundles of
permissions (see `08-api/authorization.md`). A user's effective permissions
are the union across all assigned roles. Checked once, centrally, per
request — not scattered across business logic.
