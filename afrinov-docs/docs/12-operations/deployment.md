# Deployment

Build → run database migrations → deploy application → smoke-test critical
endpoints (auth, current-stock read, a test issue in a non-prod
environment). Rollback = redeploy previous known-good build; database
migrations should be written to be forward-compatible/reversible where
practical.
