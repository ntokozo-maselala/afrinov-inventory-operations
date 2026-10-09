# Authorization Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Permission = (action, resource-type), written `action:resource`, e.g.
`create:purchase_order`, `approve:purchase_order`, `issue:inventory`; 32
codes are defined. Roles are named bundles of permissions (see
`08-api/authorization.md`). A user's effective permissions are the union
across all assigned roles.

They are loaded once per request from the `user_roles` →
`role_permissions` → `permissions` tables and cached on the request object;
each route handler then calls `requirePermission` for the permission it
needs (not one central check per request). The role-to-permission mapping
in the database is written by the seed from `shared/permissions.ts`;
changing a role's grants needs a code change and a re-seed — there is no
role-editing endpoint (`manage:roles` is unused).

## Evidence
- `afrinov-platform/apps/backend/src/shared/permissions.ts:3-91`
- `afrinov-platform/apps/backend/src/shared/authorization.ts:32-50` — load and cache
- `afrinov-platform/apps/backend/src/db/seed.ts:130-145`
