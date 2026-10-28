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

- **Authentication.** JWT HS256, 12-hour expiry, verified with an algorithm
  allowlist (`algorithms: ['HS256']`). Passwords are bcrypt-hashed at cost 12.
- **Revocation.** Every authenticated request re-reads the account's active
  flag from the database (`isActiveInDb`), so deactivation takes effect
  immediately rather than at token expiry.
- **Authorization.** Permission checks run on the server for every protected
  route via `requirePermission`. Frontend visibility is never the control.
- **Configuration.** `NODE_ENV` is validated against an allowlist; unknown
  values fail startup. Production rejects known-insecure placeholder secrets and
  any secret shorter than 32 bytes. API docs are opt-in in production.
- **CORS.** Allow-list based in every environment. Reflecting arbitrary origins
  requires the explicit `CORS_ALLOW_ANY=true` opt-in.
- **Headers.** `@fastify/helmet` sets HSTS, `X-Content-Type-Options`,
  `Referrer-Policy` and a restrictive CSP on API responses.
- **Rate limiting.** Strict per-IP limit on `/api/v1/auth/login` (5/min by
  default), separate global budget; over-limit requests return a documented 429,
  not a 500.
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

## Secret handling rules for this repository

- No credential belongs in source, tests, configuration templates, or CI files.
  The CI integration job generates throwaway secrets per run and masks them.
- If a secret is found: rotate first, then remove, then decide about history.
  Removing text alone does not undo disclosure.
- Never print a secret value in a report, log, or comment. Findings are
  described by location, not by value.
