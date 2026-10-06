# Authorization

Role-based, checked server-side on every mutating endpoint (and on
sensitive read endpoints, e.g. audit log).

## Initial roles (proposed — confirm with business)
| Role | Can do |
|---|---|
| Store Controller | Issue, receive (ad hoc), transfer, adjust, view all reports |
| Procurement | Manage suppliers, create/submit/cancel POs, receive against POs |
| Approver | Approve POs |
| Technician | Issue to self, check tools out/in, view own history |
| Admin | Manage users/roles, manage materials/locations, view audit log |
| Viewer (management) | Read-only across all reports |

A single person may hold multiple roles (e.g. today's one workbook owner
maps to Store Controller + Procurement + Admin combined) — roles compose,
they aren't mutually exclusive job titles.
