# Access Control

See `08-api/authorization.md` for the role table. Implementation notes:
- Deny-by-default: an endpoint with no explicit permission mapping is
  inaccessible, not open.
- Permission checks live in shared middleware (`shared/authorization`), not
  duplicated per route handler, to avoid the "one route forgot the check"
  failure mode.
- Fine-grained permissions (e.g. `inventory.issue`, `purchase_order.approve`)
  compose into roles, per the pattern studied from SAP's authorization
  concept but simplified (`05-sap-study/sap-not-to-copy.md`).
