# Production deployment checklist

For each release to staging or production. Some items depend on remediation
not yet done; they are marked **[needs P0-x / P1-x]** from the
[remediation plan](PRODUCTION_REMEDIATION_PLAN.md). Until those land, the
item cannot be completed and the release is not production-ready.

Commands run from `afrinov-platform/` unless stated.

## 1. Pre-deployment

- [ ] Release commit is on `main`, and every required CI check passed on it:
      Backend CI (checks, migration-drift, integration), Frontend CI, Security
      CI, CodeQL.
- [ ] Release notes list the user-visible changes, the migrations included, and
      any new or changed environment variables.
- [ ] `docs/engineering/RISK_REGISTER.md` reviewed; no new open High risk
      without a recorded acceptance.
- [ ] `docs/engineering/EXCEPTIONS.md`: no expired exception.
- [ ] The image is built once from the release commit and tagged with the
      commit SHA. The same image goes to staging and production
      **[needs P0-3]**.
- [ ] The previous production image tag is recorded here as the rollback
      target: `__________`.

## 2. Environment validation

Backend (the process refuses to start if the first three are wrong):

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET`: at least 32 random bytes, from the secret store, not a
      value that appears anywhere in the repository
- [ ] `DATABASE_URL` points at the production database and uses the
      **runtime** role, not the owner **[needs P1-5]**
- [ ] `CORS_ORIGIN` is exactly the SPA origin(s); `CORS_ALLOW_ANY` is unset
- [ ] `API_DOCS_ENABLED` is unset or `false`
- [ ] `PROCUREMENT_ENABLED` matches the go-live scope. Use `false` for a
      Stores-only launch until P0-6 is done
- [ ] `LOG_LEVEL=info`
- [ ] `RATE_LIMIT_AUTH` and `RATE_LIMIT_GLOBAL` set deliberately, or the
      defaults (5 and 1,000 per minute) accepted
- [ ] `SEED_ADMIN_PASSWORD` present only for the first bootstrap, then removed
      **[needs P0-1]**

Frontend build:

- [ ] Built with `npm run build --workspace=@afrinov/frontend`. The build
      refuses `VITE_FRONTEND_ONLY=true` and `VITE_DEMO_AUTH_ENABLED=true`
- [ ] `VITE_PROCUREMENT_ENABLED` matches the backend `PROCUREMENT_ENABLED`
- [ ] The API base URL or proxy is configured for the production origin

## 3. Security checks

- [ ] SEC-07 closed (no account with the leaked credential exists anywhere)
      **[needs P0-4]**
- [ ] The database is not reachable from the internet; the port is not
      published **[needs P1-5]**
- [ ] The SPA host sends a CSP, `Strict-Transport-Security`,
      `X-Content-Type-Options: nosniff` and `Referrer-Policy` **[needs P1-4]**
- [ ] TLS certificate is valid for at least 30 days
- [ ] `trustProxy` matches the real proxy chain **[needs P1-3]**
- [ ] `npm audit --omit=dev --audit-level=high` is clean on the release commit
      (Security CI)

## 4. Database migration checks

- [ ] List the pending migrations:
      `npx prisma migrate status` (in `apps/backend`, against production,
      read-only).
- [ ] Each pending migration has been read. Destructive statements (`DROP`,
      `ALTER … TYPE`, `NOT NULL` without a default) follow expand–contract and
      the previous release's code tolerates the new schema.
- [ ] Migrations rehearsed on staging restored from a recent production backup
      **[needs P0-2]**.
- [ ] Expected migration duration is known from the staging rehearsal; lock
      impact on large tables is considered.
- [ ] Migrations run as a separate one-off step, not on container start
      **[needs P0-3]**.

## 5. Backup verification

- [ ] The automated backup or PITR window covers the current time; last
      successful backup: `__________` **[needs P0-2]**
- [ ] An on-demand snapshot was taken immediately before migration; ID:
      `__________`
- [ ] The last restore drill is less than 90 days old; date: `__________`

## 6. Deployment execution

1. [ ] Announce the deployment window to Stores and Procurement users (open
       submissions may fail briefly).
2. [ ] Take the pre-migration snapshot (§5).
3. [ ] Run migrations: `npx prisma migrate deploy` (one-off job).
4. [ ] Deploy the new API image. Wait for `/health/ready` to return 200 on
       every instance.
5. [ ] Deploy the SPA assets. Hashed assets go first, then `index.html`.
6. [ ] Record the time the deployment completed: `__________`

## 7. Smoke tests (within 15 minutes)

Use a dedicated smoke-test account with the least privilege needed. Do **not**
post stock movements in production; use read-only checks there, and run the
write checks in staging.

- [ ] `GET /health` returns 200 and `GET /health/ready` returns 200 with
      `"database":"connected"`.
- [ ] `GET /` reports the expected `version`.
- [ ] Sign in through the SPA succeeds; the dashboard loads with no error toast.
- [ ] Materials, Stock status and Movements pages load real data. No demo
      supplier or material names appear **[PRA-01]**.
- [ ] A role without `adjust:inventory` gets the action hidden in the UI, and a
      direct API call returns 403.
- [ ] Staging only: issue, return and reversal round trip for one item leaves
      the balance unchanged.
- [ ] Error responses carry a `requestId`, and that ID appears in the central
      logs **[needs P1-2]**.

## 8. Post-deployment monitoring (first 24 hours)

- [ ] 5xx rate below 1% and no readiness failures **[needs P1-2]**.
- [ ] No growth in `SERVICE_UNAVAILABLE` or `OUTCOME_UNKNOWN` reports from
      users.
- [ ] No `INSUFFICIENT_BALANCE` spike, which can indicate a balance problem.
- [ ] Run the balance reconciliation query
      ([runbook §8](OPERATIONAL_RUNBOOK.md#8-data-integrity-incident)) once
      after the first business day; it returns zero rows.

## 9. Rollback

Decide within 30 minutes of deployment if any smoke test fails or the error
rate is elevated.

**Application-only release (no migrations):** redeploy the previous image tag
and previous SPA assets, then re-run §7.

**Release with additive migrations (expand step):** redeploy the previous image.
Leave the schema in place; the previous code tolerates it under the
expand–contract rule. Re-run §7.

**Release with a destructive migration, or a failed migration:**
1. Stop the API (scale to 0) so no writes continue.
2. Restore from the pre-migration snapshot (§5) into a **new** database;
   follow [runbook §9](OPERATIONAL_RUNBOOK.md#9-backup-restoration).
3. Point the previous image at the restored database and start it.
4. Re-run §7 and the reconciliation query.
5. Writes made between the snapshot and the stop are lost. Identify them from
   the central logs and audit trail, and tell the affected users to re-enter
   them.

Prisma migrations here are forward-only; there are no down scripts. Never
hand-edit `_prisma_migrations` in production without a reviewed plan.

- [ ] Rollback decision and its reason recorded in the release notes.
