# Operational runbook

Procedures for operating the Afrinov Inventory & Operations platform.

> **Status: UNVERIFIED.** No production or staging environment exists yet
> (PRA-03). Every procedure below is derived from the code (commit `60a1432`,
> updated for the 2026-10-30 remediation branch) and has **not been rehearsed**. Steps that depend on
> infrastructure not yet chosen are marked **[host-specific]**. Rehearse each
> section in staging and record the date before relying on it.

## 0. Reference

**Components:** the SPA (static files), the API (Node 24 container, port 4000,
stateless apart from in-memory rate-limit counters) and PostgreSQL 16 (the
system of record).

**Health endpoints** (no authentication needed, available at the root and
under `/api/v1`):

| Endpoint | Meaning | Healthy | Unhealthy |
|---|---|---|---|
| `GET /health` | Process is alive | 200 `{"status":"ok"}` | No response |
| `GET /health/ready` | Database reachable (`SELECT 1`) | 200 `{"database":"connected"}` | 503 `{"database":"error"}` |
| `GET /` | Version and environment | 200 with `version` | — |

**Error codes users and logs show** (`src/shared/errors.ts`):

| Code | HTTP | Usually means |
|---|---|---|
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable or timed out (Prisma P1001/P1002/P1008/P1017 …) |
| `UNAUTHENTICATED` | 401 | Bad, expired or revoked token, or a deactivated account |
| `FORBIDDEN` | 403 | Missing permission |
| `TOO_MANY_REQUESTS` | 429 | Rate limit (login: 5/min per IP by default) |
| `INSUFFICIENT_BALANCE` | 422 | Refused because stock would go negative (expected business refusal) |
| `INVALID_STATE` / `CONFLICT` | 409 | Status-guarded write lost a race, or a duplicate |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Client reused a submission ID with a different body |
| `INTERNAL_ERROR` | 500 | Unexpected defect; logged at `level:50` with `"msg":"Unhandled error"` |

**Logs:** pino JSON on stdout. Useful fields: `level` (30 info, 40 warn,
50 error), `requestId` (a UUID, unique across restarts and instances), `msg`,
`err`.

**Sign-in trail:** every attempt is an `audit_log_entries` row with
`entity_type = 'Authentication'` and `action` `LOGIN_SUCCEEDED`,
`LOGIN_FAILED` (with `after.reason`) or `LOGIN_LOCKED`, carrying `after.ip`
and `after.userAgent`. An unknown email is recorded only as a fingerprint.

**Who to call:** not yet defined (checklist O-10). Fill in before go-live:

| Role | Name | Contact |
|---|---|---|
| Incident lead | | |
| Database / platform | | |
| Application (backend) | | |
| Business contact (Stores) | | |

---

## 1. Application unavailable

**Symptoms:** the SPA does not load, or every API call fails with a network
error. `/health` gives no response.

1. Check whether the problem is the SPA host or the API:
   - The SPA URL does not load → SPA host or DNS/TLS issue **[host-specific]**.
   - The SPA loads but `GET <api>/health` fails → API issue; continue.
2. Check the API container or process status and its recent logs
   **[host-specific]**. Look for:
   - `Configuration error: …` at startup. A required variable is missing or
     invalid: `DATABASE_URL`, `JWT_SECRET` (must be ≥ 32 bytes and not a known
     placeholder in production), or `NODE_ENV`. Fix the environment, not the
     code.
   - `Uncaught exception:` or `Unhandled promise rejection:`. The process
     exited by design (`src/index.ts`). Capture the stack and restart.
   - `Failed to start server`. Usually the port is already in use.
3. Restart the API **[host-specific]**. It must log `Backend startup complete`
   followed by `HTTP server listening`.
4. Confirm `/health` returns 200, then `/health/ready` returns 200.
5. If it crash-loops on the same exception, roll back to the previous image
   ([deployment checklist §9](PRODUCTION_DEPLOYMENT_CHECKLIST.md#9-rollback)).

## 2. Database unavailable

**Symptoms:** `/health` 200 but `/health/ready` 503. Users see "temporarily
unavailable". Logs show `Readiness check failed` and `Database error` with
`code: SERVICE_UNAVAILABLE`.

1. Confirm from a host that can reach the database **[host-specific]**:
   `pg_isready -h <host> -p 5432`.
2. Check the database provider's status, storage (a full disk stops writes),
   connection count and credentials (`P1000` means authentication failed,
   for example after a password rotation).
3. Each API instance holds at most 10 connections (`shared/db.ts`). If the
   connection limit is exhausted, check for other clients and long-running
   queries:
   `SELECT pid, now()-query_start AS age, state, left(query,80) FROM pg_stat_activity ORDER BY age DESC NULLS LAST;`
4. The API reconnects on its own once the database is back; no restart is
   needed. Confirm `/health/ready` returns 200.
5. Tell users that any submission made during the outage that showed
   "outcome unknown" must be checked on the Movements page before they retry.
   Inventory forms are retry-safe with the same submission
   (`Idempotency-Key`). Purchase-order actions are not (PRA-17), so check for a
   duplicate first.
6. If the database cannot be recovered, go to §9.

## 3. Authentication failures

**Symptoms:** users cannot sign in, or are signed out unexpectedly.

| Observation | Likely cause | Action |
|---|---|---|
| Everyone signed out at once after a deploy | `JWT_SECRET` changed (all tokens invalidated) | Expected after a secret rotation; users sign in again. If not intended, restore the previous secret from the secret store |
| `TOO_MANY_REQUESTS` on login for many users in the same office | All users share one IP, or the API sees only the proxy IP | Set `TRUST_PROXY` to the proxy hop count (usually `1`) and restart; if they really share one public IP, raise `RATE_LIMIT_AUTH` |
| One user gets `ACCOUNT_LOCKED` | Five wrong passwords in a row | Waits out 15 minutes, or an administrator resets the password (Settings → Users → Reset password), which lifts the lock. Check the sign-in trail for attempts from unexpected addresses first |
| One user gets `Invalid credentials` | Wrong password, or account deactivated | Check the user is active under Settings → Users. If they forgot it, reset the password there; they choose a new one at their next sign-in |
| A user is sent to "Choose a new password" | An administrator reset their password (or it is the bootstrap admin's first sign-in) | Expected. They need the temporary password from the administrator |
| `Account unavailable` (401) | Account deactivated after sign-in | Expected; reactivate if appropriate |
| Login returns 503 | Database down | §2 |

**Bootstrap admin password rotation** (for `admin@afrinov.local` only):
`SEED_ADMIN_PASSWORD=<new> npm run db:rotate-admin` from
`afrinov-platform/`, with `DATABASE_URL` pointing at the target. Treat this as
a controlled change and record it.

**Lost last administrator (ARCH-01, PRA-13):** the application now refuses to
let the last active administrator demote or deactivate themselves. If all
administrators are still lost (for example, forgotten passwords), rotate the
bootstrap admin with `npm run db:rotate-admin` as above. Anything else needs
a reviewed SQL change by an engineer with database access. Escalate.

## 4. API failures

**Symptoms:** specific actions fail with "something went wrong" (500
`INTERNAL_ERROR`), while health is fine.

1. Ask the user for the reference shown with the error. That is the
   `requestId`.
2. Search the logs for that `requestId`. Find the `level:50` line
   `Unhandled error`; its `err.stack` locates the defect.
3. 4xx responses are client or business refusals, not outages. 409 and 422
   are expected under normal use.
4. If one endpoint fails consistently after a deploy, roll back
   ([deployment checklist §9](PRODUCTION_DEPLOYMENT_CHECKLIST.md#9-rollback)).
5. Record the defect with the `requestId`, timestamp and stack.

## 5. Elevated error rates

**Prerequisite:** alerting (PRA-08 / P1-2). Until that exists, this is
noticed only through user reports.

1. Break the errors down by status: 5xx (ours) against 4xx (callers).
2. Many 503s point to the database (§2). Many 500s point to a defect (§4).
   Many 429s point to rate limiting (§3). Many 401s point to secret or token
   problems (§3).
3. Correlate with the most recent deployment time. If the errors began at a
   deploy, roll back first and investigate afterwards.

## 6. Performance degradation

**No baseline exists yet (PRA-18).** These steps are diagnostic only.

1. Check database load: active queries (§2 step 3), and locks:
   `SELECT pid, wait_event_type, wait_event, left(query,80) FROM pg_stat_activity WHERE wait_event IS NOT NULL;`
2. Advisory-lock waits (`wait_event = 'advisory'`) are expected briefly. Stock
   writes for the same item and location are serialised by design. Sustained
   waits mean a long-running transaction is holding a lock; find it by age.
3. The API cancels HTTP requests after 30 s, but **the database query keeps
   running** (no statement timeout, PRA-18). A runaway query can be cancelled
   with `SELECT pg_cancel_backend(<pid>);` (safe: the transaction rolls back).
   Avoid `pg_terminate_backend` unless cancel fails.
4. Large exports (month-end, movements) are CPU-heavy in the API process. If
   they correlate with the slowdown, ask users to stagger them.

## 7. Failed deployments

Follow [PRODUCTION_DEPLOYMENT_CHECKLIST.md §9](PRODUCTION_DEPLOYMENT_CHECKLIST.md#9-rollback).

Specific cases:
- **A migration failed partway:** Prisma marks it failed in
  `_prisma_migrations` and refuses further deploys. Do not delete that row.
  Restore the pre-migration snapshot (§9) unless the engineer who wrote the
  migration confirms it is safe to fix forward with
  `prisma migrate resolve`.
- **The new version is up but readiness fails:** check `DATABASE_URL` and
  role permissions for the new release, then §2.

## 8. Data integrity incident

**Symptoms:** a stock figure is reported wrong, a movement appears twice, or a
balance does not match the Movements page.

1. **Do not edit or delete ledger rows.** Corrections are reversals
   (`POST /api/v1/inventory-transactions/:id/reversal`, permission
   `reverse:inventory_transaction`) or adjustments, made through the
   application so they are audited (ADR-002, ADR-005).
2. Run the **reconciliation query** (read-only). It lists every
   (material, location) where the stored balance differs from the ledger:
   ```sql
   SELECT material_id, location_id,
          COALESCE(b.quantity, 0) AS stored_balance,
          COALESCE(t.total, 0)    AS ledger_total
   FROM inventory_balances b
   FULL OUTER JOIN (
     SELECT material_id, location_id, SUM(quantity) AS total
     FROM inventory_transactions GROUP BY material_id, location_id
   ) t USING (material_id, location_id)
   WHERE COALESCE(b.quantity, 0) <> COALESCE(t.total, 0);
   ```
   And for negative stock, which the application should never allow:
   `SELECT * FROM inventory_balances WHERE quantity < 0;`
3. If both return no rows, the data is consistent. The report is then a
   business question (wrong item, wrong location, or wrong recipient
   recorded); trace it on the Movements page and the audit history.
4. If the reconciliation returns rows, treat it as a defect. Capture the
   output, then find the most recent `inventory_transactions` for those keys
   and the `audit_log_entries` around them. Escalate to the backend owner.
   **[unverified]** The balance for one key can be rebuilt from the ledger by
   any normal stock movement on that key, because every write recomputes from
   the ledger. Do not run ad-hoc `UPDATE inventory_balances`.
5. **Duplicate movement:** check whether the two rows have the same actor and
   timestamps seconds apart. If a client submitted without an
   `Idempotency-Key`, the duplicate is real. Reverse one copy through the
   application and record the reason.
6. **Demo data found in production (PRA-01):** stop and escalate. Removing it
   means deleting ledger rows, which needs a reviewed, one-off plan and a
   backup taken first.

## 9. Backup restoration

> **No backup exists today (PRA-02). This procedure cannot be carried out until
> P0-2 is complete.** It is written so the drill has a script to follow.

1. Decide the recovery point (a timestamp just before the incident) and record
   why.
2. Stop writes: scale the API to 0 **[host-specific]**.
3. Restore into a **new** database instance or database, never over the
   existing one **[host-specific: PITR restore, or
   `pg_restore --no-owner -d <new_db> <dump>`]**.
4. Validate the restored database:
   - `npx prisma migrate status` shows every migration applied.
   - The reconciliation query (§8) returns no rows.
   - Row counts for `inventory_transactions`, `purchase_orders` and
     `audit_log_entries` are plausible against the last known figures.
5. Point the API's `DATABASE_URL` at the restored database and start it.
   Confirm `/health/ready` returns 200, then run the smoke tests
   ([deployment checklist §7](PRODUCTION_DEPLOYMENT_CHECKLIST.md#7-smoke-tests-within-15-minutes)).
6. Tell users the recovery point. Anything entered after it must be re-entered
   from paper slips and delivery notes.
7. Keep the old database read-only for investigation until the incident is
   closed.
8. Record the timings. Measured RTO is from step 2 to step 5.

## 10. Security incident

Examples: a suspected leaked password or `JWT_SECRET`, unexpected
administrative changes, or unknown accounts.

1. **Contain.**
   - Compromised user account: deactivate it under Settings → Users, or reset
     its password there. Both take effect on the next request: each request
     checks account status in the database, and a reset refuses every token
     issued before it.
   - Compromised `JWT_SECRET`: rotate it in the secret store and restart all
     instances. Every session is invalidated.
   - Compromised database credential: rotate it at the provider, update
     `DATABASE_URL`, restart.
2. **Preserve evidence.** Export the relevant `audit_log_entries`
   (`entity_type`, `actor_id`, `created_at`) and the API logs for the window
   before anything is changed further. Sign-ins are in the audit log as
   `entity_type = 'Authentication'` (see §0); the IP recorded is the client's
   only when `TRUST_PROXY` matches the proxy chain.
3. **Assess.** What did the actor do? Filter audit entries by `actor_id`.
   Check Movements for that user. Check for new users or role changes
   (`entity_type = 'User'`).
4. **Recover.** Reverse unauthorised movements through the application. Revert
   role changes. Reset affected passwords under Settings → Users.
5. **Report.** Follow the disclosure policy in `SECURITY.md`. If personal
   information was exposed, assess POPIA notification duties with the
   information officer.
6. **Repository secrets.** The repository is public. A committed secret must be
   rotated first; then record it in `docs/engineering/EXCEPTIONS.md`. Never add
   a gitleaks allowlist entry for a real secret (AGENTS.md).

---

## Rehearsal record

| Section | Rehearsed in | Date | By | Result / changes made |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |
