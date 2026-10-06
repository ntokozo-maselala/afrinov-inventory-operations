# Security Testing

- Automated tests for authorization (a Technician cannot approve a PO, an
  unauthenticated request is rejected) as part of the standard test suite
  (`11-testing/`), not a separate one-off audit.
- Periodic dependency vulnerability scanning as part of CI.
- Manual review of any endpoint that touches money/value (stock valuation,
  future finance integration) before release.
