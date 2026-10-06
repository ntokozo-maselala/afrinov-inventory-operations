# Production Readiness Checklist

**Application**
- [ ] Build succeeds
- [ ] Typecheck succeeds
- [ ] Lint succeeds
- [ ] All tests pass (`11-testing/test-traceability.md` fully green)
- [ ] Error handling verified against `08-api/error-model.md`
- [ ] Authorization verified for every role in `08-api/authorization.md`
- [ ] Audit logging verified end to end

**Database**
- [ ] Migrations tested on a staging copy
- [ ] Constraints verified (no path bypasses ADR-002)
- [ ] Indexes reviewed against expected query patterns
- [ ] Backup tested
- [ ] Restore tested

**Security**
- [ ] Authentication in place
- [ ] Authorization in place
- [ ] Secrets managed per `10-security/secrets-management.md`
- [ ] Input validation on every write endpoint
- [ ] Audit trail confirmed immutable

**Operations**
- [ ] Monitoring live
- [ ] Logging live
- [ ] Alerts configured
- [ ] Health checks in place
- [ ] Deployment rollback tested

**Migration**
- [ ] Reconciliation report clean
- [ ] UAT signed off
- [ ] Cutover date agreed with business owner
- [ ] Workbooks archived read-only post-cutover
