<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-ENG-006</b></td>
<td align="center"><b><i>Quality gates</i></b><br><i>Engineering Assurance</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-ENG-006 updated=2026-11-27 by="Ntokozo Maselala" body=a1d105c85963 -->

# Quality gates

Every gate has a purpose, an executable check, an explicit pass/fail rule, a
trigger, and a failure policy. Gates run in CI (`.github/workflows/`) and can be
reproduced locally with the same commands.

## Gate matrix

| Gate | Check (command) | Pass rule | Trigger | Failure policy |
|---|---|---|---|---|
| Install | `npm ci` | Lockfile resolves | Every PR / push | Block |
| Typecheck | `npm run typecheck` | Exit 0 | Every PR; each app's check runs when its paths, the workspace manifests or its workflow changed (the frontend's also on backend paths), else skipped as a pass | Block once required (GATE-02) |
| Lint | `npm run lint` | Exit 0 | As typecheck | Block once required (GATE-02) |
| Unit tests | `npm test` | All pass | As typecheck | Block once required (GATE-02) |
| Build | `npm run build` | Exit 0 | As typecheck | Block once required (GATE-02) |
| Integration tests | `npm run test:integration` | All pass | Every PR; runs when backend paths, the workspace manifests or `backend-ci.yml` changed | Block once required (GATE-02) |
| Migration drift | `prisma migrate diff … --exit-code` | Empty diff (exit 0) | As integration tests | Block once required (GATE-02) |
| Migration apply | `prisma migrate deploy` on a clean DB | Exit 0 | As integration tests | Block once required (GATE-02) |
| Browser tests | `npx playwright test` on a real backend | All pass | Every PR; runs when frontend or backend paths, the workspace manifests or `frontend-ci.yml` changed | Block once required (GATE-02) |
| Dependency audit (prod) | `npm audit --omit=dev --audit-level=high` | No high/critical | Every PR / push / weekly | Block |
| Dependency audit (full) | `npm audit` | — | Every PR / push | Advisory only |
| Secret scanning | `gitleaks detect … --exit-code 1` | No new leak | Every PR / push | Block |
| CodeQL | `github/codeql-action` | No new alerts | PR, push, weekly | Block (via branch protection) |
| Workflow lint | `actionlint` | Exit 0 | Local / review | Advisory |
| Document control | `npm run docs:test` and `npm run docs:check` | All pass; every controlled document's header current | Every PR / push | Block |
| Relative links | `npm run docs:links` | — | Every PR / push | Advisory only |

## Where each gate runs

- **Stage A (change validation):** `backend-ci.yml` `checks` job and
  `frontend-ci.yml` `checks` job — typecheck, lint, unit tests, build.
- **Stage B (PR assurance):** the above plus `backend-ci.yml` `integration`,
  `migration-drift`, `frontend-ci.yml` `e2e` (the Playwright browser tests,
  system audit H5), `security-ci.yml` (audit + secret scan), and `docs-ci.yml`
  (document control).
- **Stage C (main-branch verification):** the same workflows run on `push` to
  `main`, re-verifying the merged commit.
- **Weekly:** `security-ci.yml` and `codeql.yml` re-run on a schedule so a newly
  published advisory or a new CodeQL query fails without a code change.

## Running the gates locally

From `afrinov-platform/`:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
npm run docs:stamp   # after changing any document, then commit what it writes
npm run docs:check
```

Integration tests and migration checks need a disposable PostgreSQL database
(see `apps/backend/README.md`). The drift check:

```sh
cd afrinov-platform/apps/backend
DATABASE_URL=… npx prisma migrate deploy
DATABASE_URL=… npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code
```

Secret scan (from the repository root):

```sh
gitleaks detect --source . --redact --no-banner \
  --config .gitleaks.toml --baseline-path .gitleaks-baseline.json --exit-code 1
```

## Investigating a failure

| Gate failed | First thing to look at |
|---|---|
| Typecheck / lint | The reported file and line; these are deterministic |
| Unit tests | The failing test name and assertion; run just that file |
| Integration tests | Is PostgreSQL reachable and is `SEED_ADMIN_PASSWORD` set? See `apps/backend/README.md` |
| Migration drift | Run the `migrate diff` command; the emitted SQL is the missing change. Add a migration; do not edit the schema to match a wrong database |
| Dependency audit | The advisory's package and severity; check whether a patched version exists in range |
| Secret scan | The file, line and commit in the report. **Do not paste the value anywhere.** If it is real: rotate, then remove |
| Document control | The files it names. Run `npm run docs:stamp` and commit what it writes; never edit a header by hand. See `docs/document-control/README.md` |

## Exceptions

A gate may be bypassed only through a documented exception in `EXCEPTIONS.md`
that names the gate, the reason, the mitigating control, the accountable owner,
and an expiry or review date. No security finding may be silently suppressed.

## Deliberately not gated

- **Coverage percentage threshold.** Coverage numbers alone do not prove test
  quality. Critical behavior (authorization, ledger integrity, configuration)
  is covered by targeted tests, and the AUD-01 test was shown to fail against
  the unfixed code. A coverage gate would add ceremony without that evidence.
- **Mutation testing.** Not introduced. It is a reasonable next step once the
  existing suite is stable in CI; noted in `IMPLEMENTATION_ROADMAP.md`.
- **DAST, SBOM, artifact signing, progressive delivery.** No running
  environment, artifact registry, or deployment pipeline exists in this
  repository to attach them to. Adding them would be ceremony, not control. See
  `IMPLEMENTATION_ROADMAP.md` for the conditions under which each becomes worth
  adding.
