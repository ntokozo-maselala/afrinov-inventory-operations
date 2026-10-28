# Engineering assurance

How this repository is verified, secured, and released. These documents
describe controls that exist in the repository; where a control is missing, the
gap is stated rather than implied away.

| Document | What it covers |
|---|---|
| [`BASELINE_ASSESSMENT.md`](BASELINE_ASSESSMENT.md) | The state of the repository before this workstream: what works, what was missing, what was fixed |
| [`VERIFICATION_EVIDENCE.md`](VERIFICATION_EVIDENCE.md) | Raw commands, exit statuses and results backing every claim |
| [`QUALITY_GATES.md`](QUALITY_GATES.md) | Every gate, its check, pass rule, trigger, failure policy and local command |
| [`SECURITY_CONTROLS.md`](SECURITY_CONTROLS.md) | Security scope, methods, findings and remediation — including the open credential finding |
| [`DATABASE_ASSURANCE.md`](DATABASE_ASSURANCE.md) | Migration verification, integrity checks, and the DATA-03 fix |
| [`CI_CD_ARCHITECTURE.md`](CI_CD_ARCHITECTURE.md) | The pipeline: workflows, stages, branch protection, and what is not implemented |
| [`TESTING_GUIDE.md`](TESTING_GUIDE.md) | How to run each test layer locally and what each layer is for |
| [`RISK_REGISTER.md`](RISK_REGISTER.md) | Prioritised risks with evidence, impact, remediation and owner |
| [`EXCEPTIONS.md`](EXCEPTIONS.md) | Reviewed deviations from a gate |
| [`IMPLEMENTATION_ROADMAP.md`](IMPLEMENTATION_ROADMAP.md) | Completed work, outstanding work, and the conditions for each next step |

## Start here

- New to the repository: read `BASELINE_ASSESSMENT.md`, then `TESTING_GUIDE.md`.
- Reviewing a change: check it against `QUALITY_GATES.md`.
- Investigating a failed gate: the "Investigating a failure" table in
  `QUALITY_GATES.md`.
- Understanding a risk: `RISK_REGISTER.md`.

## Scope and honesty

The work recorded here is **repository-scoped**. No production environment was
accessed, and no DAST, penetration test or infrastructure assessment was
performed. "Pipeline implementation complete" and "verification passing" are
distinct from "production readiness", which additionally requires the
operational evidence tracked as OPS-01 in `RISK_REGISTER.md`.
