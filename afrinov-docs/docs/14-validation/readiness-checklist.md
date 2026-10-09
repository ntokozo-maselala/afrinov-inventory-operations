# Production Readiness Checklist

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Boxes are ticked only at the go-live review, not by this document. The note
after each item records the evidence available at commit 4e6d76f.

**Application**
- [ ] Build succeeds — CI builds both apps on every relevant pull request.
- [ ] Typecheck succeeds — passed locally 2026-10-09 (both apps).
- [ ] Lint succeeds — run in CI; not run in this check.
- [ ] All tests pass (`11-testing/test-traceability.md` fully green) — unit
      tests passed locally 2026-10-09 (backend 492, frontend 389);
      integration and E2E not run; BR-008 has no tests (not built).
- [ ] Error handling verified against `08-api/error-model.md` — central
      handler exists (`src/server.ts`); not formally verified.
- [ ] Authorization verified for every role in `08-api/authorization.md` —
      grants unit-tested; no per-route test (TD-014).
- [ ] Audit logging verified end to end — known gaps (TD-008).

**Database**
- [ ] Migrations tested on a staging copy — no staging environment yet.
- [ ] Constraints verified (no path bypasses ADR-002) — balance FKs missing
      (TD-005).
- [ ] Indexes reviewed against expected query patterns
- [ ] Backup tested — no backup in place (`12-operations/backup-and-recovery.md`).
- [ ] Restore tested

**Security**
- [ ] Authentication in place — JWT login implemented.
- [ ] Authorization in place — per-route permission checks implemented.
- [ ] Secrets managed per `10-security/secrets-management.md`
- [ ] Input validation on every write endpoint — Zod schemas on every
      write route.
- [ ] Audit trail confirmed immutable — not enforced in the database (TD-006).

**Operations**
- [ ] Monitoring live — health checks only.
- [ ] Logging live — structured request logs; no shipping configured.
- [ ] Alerts configured — none.
- [ ] Health checks in place — `/health`, `/health/ready`.
- [ ] Deployment rollback tested — no deployment pipeline.

**Migration**
- [ ] Reconciliation report clean — tool exists (`import:workbook --reconcile`).
- [ ] UAT signed off
- [ ] Cutover date agreed with business owner
- [ ] Workbooks archived read-only post-cutover

## Evidence
- Local run of `npm run typecheck` and `npm test` in `afrinov-platform/` on 2026-10-09 (Node v24.21.0)
- `.github/workflows/backend-ci.yml`, `.github/workflows/frontend-ci.yml`
- `afrinov-platform/apps/backend/src/server.ts:180-222`
- `afrinov-platform/apps/backend/scripts/import-workbook.ts:71-96`
