# CI/CD

On every change: install, typecheck, lint, run unit + integration tests
(against an ephemeral test database), build. On merge to main: additionally
run API/E2E tests against a staging-like environment, then deploy to
staging automatically; production deploy is a manual/gated promotion.
