<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-ENG-009</b></td>
<td align="center"><b><i>Security controls</i></b><br><i>Engineering Assurance</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-ENG-009 updated=2026-11-27 by="Ntokozo Maselala" body=f6917829fb56 -->

# Security controls

Scope of the security work performed in this workstream, the methods used, what
was found, what was changed, and — importantly — what was **not** assessed.
A security review is complete only within its stated scope; this one is scoped
to the repository and does not include a live production environment.

## Scope and methods

| Method | Tool / technique | Applied to |
|---|---|---|
| Static analysis | CodeQL (`javascript-typescript`, `actions`) | Whole repository, on PR, push to main, weekly |
| Secret scanning | gitleaks 8.30.1, full history | Whole repository, every commit |
| Software composition analysis | `npm audit` (production and full) | Workspace lockfile |
| Source review | Manual, targeted | Authentication, authorization, configuration, ledger writes |
| Authorization testing | Integration tests over real HTTP | Role/permission enforcement on the API boundary |
| Failure injection | Test-only PostgreSQL trigger | Audit atomicity (AUD-01) |
| Supply-chain review | Manual + `actionlint` | CI workflow action references and permissions |

Not performed, and therefore not claimed: dynamic application security testing
(DAST) against a running deployment, penetration testing, production
infrastructure/network assessment, cloud IAM review, or a review of any
environment outside this repository. These are listed as open items in
`RISK_REGISTER.md`.

## Controls confirmed in place

- **Authentication.** JWT HS256, verified with an algorithm allowlist
  (`algorithms: ['HS256']`). Passwords are bcrypt-hashed at cost 12.
- **Idle sign-out (ADR-035).** A token lasts the idle time in
  `security.sessionTimeoutMinutes` and is renewed by `POST /auth/refresh` while
  the person is active; a sign-in ends 12 hours after it began (`auth_time`).
  Every authenticated request refuses a token older than the idle time in force
  now, so a shorter setting applies at once. Rules in
  `src/modules/identity/session-policy.ts`, tested in `session-policy.test.ts`
  and `auth.routes.test.ts`.
- **Revocation.** Every authenticated request re-reads the account's active
  flag from the database (`isActiveInDb`), so deactivation takes effect
  immediately rather than at token expiry.
- **Authorization.** Permission checks run on the server for every protected
  route via `requirePermission`. Frontend visibility is never the control.
- **Configuration.** `NODE_ENV` is validated against an allowlist; unknown
  values fail startup. Production rejects known-insecure placeholder secrets and
  any secret shorter than 32 bytes. API docs are opt-in in production.
- **CORS.** Allow-list based in every environment. Reflecting arbitrary origins
  requires the explicit `CORS_ALLOW_ANY=true` opt-in, and production refuses to
  start with it (SEC-04).
- **Headers.** `@fastify/helmet` sets HSTS, `X-Content-Type-Options`,
  `Referrer-Policy` and a restrictive CSP on API responses.
- **Rate limiting.** Strict per-IP limit on `/api/v1/auth/login` and
  `/api/v1/auth/password` (5/min by default), separate global budget, and 10
  wrong passwords per account in 15 minutes; over-limit requests return a
  documented 429, not a 500. Behind a proxy, `TRUST_PROXY` names it, so the
  address counted is the person's (ADR-036).
- **Passwords and Admin access (ADR-036).** Anyone changes their own password
  with the current one; an Admin sets a temporary password that must be changed
  before anything else. A password change ends the account's other sign-ins. A
  change that would leave no active Admin is refused, and once two Admins
  exist, so is one that would leave one.
- **Input validation.** Zod schemas validate request bodies; report query arrays
  are bounded.
- **Error handling.** A central handler maps `ApiError` to the documented error
  contract and never leaks internal error messages for unexpected failures.
- **Ledger integrity.** `inventory_transactions` is append-only through the API;
  balance changes are serialized with PostgreSQL advisory locks.
- **Audit trail.** Administrative user changes are recorded (now atomically —
  see AUD-01 below).
- **Test isolation.** Database-backed tests refuse any non-loopback or non-`_test`
  database, so tests cannot touch development or production data.

## Findings and remediation in this workstream

### AUD-01 — A change could commit without its audit record (fixed)

Several services wrote the business row first and the audit row in a separate
statement. `UserService.create`/`update` were the first observed instance;
`MaterialService.create`/`update`, `ProjectService.create`/`update`/`archive`
and `SettingsService.set` shared the same defect. An audit failure left an
administrative change with no record, while the caller saw an error.

**Fix:** every mutation and its audit record now share one
`prisma.$transaction`, in identity, material, project and settings. The
regression test `integration/identity-audit-atomicity.real-http.test.ts` injects
an audit failure through a test-only PostgreSQL trigger and asserts the business
row is unchanged, for all four services. With a fix reverted the matching case
fails; restored, it passes. The audit entries still missing entirely (issue,
transfer, adjustment, purchase-order creation, goods-receipt create/post) are
tracked as TD-008.

### DATA-03 — Missing foreign keys on `inventory_balances` (fixed)

The schema declares relations from `inventory_balances` to `materials` and
`locations`, but no migration created those constraints, so an out-of-band write
could leave a balance pointing at a deleted item. Fixed by migration
`20260101000027_inventory_balance_foreign_keys`, which refuses to run while
orphan rows exist and is verified by the new CI drift gate. See
`DATABASE_ASSURANCE.md`.

### SEC-07 — Committed bootstrap admin password in history (OPEN — action required)

A gitleaks scan over full history found a real credential:

- **What:** a hard-coded default administrator password in
  `afrinov-platform/apps/backend/src/shared/defaultAdmin.ts`
  (`DEFAULT_ADMIN_PASSWORD`, with a real person's email as the default account).
- **Where:** commit `db1501ac0b` (2026-10-22), which is an ancestor of `main`.
  The file was removed later, so it is **not** in the current tree, but the blob
  remains in the public repository's history.
- **Why it matters:** the repository is public. Anyone can read that value. If
  the account it seeds (`vusi.local@afrinov.co.za`) still exists, or if the same
  password is reused anywhere, it is a direct account-takeover vector.
- **Exposure:** the value is not reproduced in this document, in the scan
  baseline, or in any committed artifact. Deleting text from a file does not
  remove it from history, and rotating the password is the only action that
  actually removes the risk.

**Required action (owner: application/security owner):**

1. Confirm whether an account with that email exists in any live environment.
2. Rotate that account's password immediately; if the account is unused, delete
   it.
3. Confirm the same value is not reused for any other account, service, or
   environment.
4. Record the outcome in `EXCEPTIONS.md`.

Rewriting public Git history is **not** recommended here: the value has already
been disclosed, history rewriting is disruptive to every clone, and rotation is
the effective control. If the owner decides the credential is still live and
cannot be rotated, escalate.

The scan is configured (`.gitleaks.toml` plus a redacted baseline) to keep
failing on **new** secrets while not re-printing this known one. The baseline
stores only the finding's location and fingerprint, never the value, and a
negative test confirmed the gate still catches a newly planted secret.

**Allowlist correctness (review finding, fixed).** The first version of
`.gitleaks.toml` paired a `paths` list with the placeholder `regexes`. Gitleaks
combines those two criteria with OR, so a path match alone suppressed *every*
finding in the listed files — a real credential committed to `config.ts` or
`security.regression.test.ts` would have passed the scan. This was reproduced:
planting a token in each file was silently ignored. `condition = "AND"` does not
fix it; gitleaks 8.30.1 ignores that key. The allowlist now matches **values
only** (no `paths`), which cannot hide an unrelated secret. Verified both ways:
a planted token in each previously-blinded file now fails the scan, and the
published placeholders still pass.

### SUPPLY-01 — Mutable action references (fixed)

CI workflows referenced actions by tag (`@v4`, `@v7`), which an upstream owner
can move to different code. All action references are now pinned to immutable
commit SHAs with the tag in a trailing comment, and each workflow declares
least-privilege `permissions: contents: read`.

## Production readiness review, 2026-11-27

A second pass, at `71395dc`, that tested the running API rather than only reading
the code. Method and results:
[`production-readiness-audit.md`](../audits/system/production-readiness-audit.md),
section "Security"; raw output: `VERIFICATION_EVIDENCE.md`, the section of the same
name.

### What was confirmed

- **Authentication:** all 183 protected endpoints answer 401 without a token.
- **Authorisation:** an account for each of VIEWER, APPROVER, TECHNICIAN, SALES and
  PROCUREMENT sent all 88 write operations; none succeeded. A VIEWER who is not a
  project's manager was refused (403) on a real schedule, step and slip. A route
  that answered 400 or 404 to that account did so because it checks ownership on the
  record, and was shown to refuse once the record exists.
- **Injection:** no unsafe raw query in the code; `GET /audit`'s filters are bound
  values (`audit.routes.test.ts`). A SQL fragment in every query parameter of every
  GET was refused before it reached SQL.
- **Frontend output:** no HTML-injection sink; error text always through
  `presentError`.

### What was fixed

- **SEC-08** (four CodeQL alerts): the polynomial regex in `cleanWebsite` replaced
  with a linear trim; Markdown cells in the import reports escape backslashes
  before pipes. Not reachable from the API (`website` is capped at 200 characters),
  but open High alerts on a public repository.
- **SEC-03, in part:** `docker-compose.yml` now binds the database and API to
  `127.0.0.1`, as the production overlay already did. On a developer machine the
  database had been listening on every interface.
- **TD-029** (a reliability fault more than a security one): unknown enum filters
  no longer reach Prisma and are no longer logged as unhandled errors, which kept
  false alarms out of the error log.

### What is still open

SEC-07 (rotate the password in history, owner), **GATE-02** (`main` is protected
since 2026-11-27, but Backend and Frontend CI are not yet required), the rest of SEC-03 (the API's database role), SEC-05, SEC-06, TD-006 and
TD-014. Their next steps are in `REMEDIATION_PLAN.md`.

## Secret handling rules for this repository

- No credential belongs in source, tests, configuration templates, or CI files.
  The CI integration job generates throwaway secrets per run and masks them.
- If a secret is found: rotate first, then remove, then decide about history.
  Removing text alone does not undo disclosure.
- Never print a secret value in a report, log, or comment. Findings are
  described by location, not by value.
