# Exceptions register

Documented, reviewed deviations from a quality or security gate. Each entry
names the gate, the reason, the mitigating control, the accountable owner, and
an expiry or review date. No exception may be added silently.

| ID | Gate / control | Reason | Mitigating control | Owner | Review by | Status |
|---|---|---|---|---|---|---|
| EX-01 | Secret scanning (`gitleaks`) | One real credential exists in reachable history and cannot be removed by a code change (see SEC-07) | The value is not reproduced in any committed artifact; the account must be rotated; the scan baseline is redacted and suppresses only this one finding | Application/security owner | On rotation completion | **Open — action required** |
| EX-02 | Dependency audit (dev-only findings) | `npm audit` (full) can report dev-only advisories in build/test tooling | The blocking gate uses `--omit=dev`; the full report runs informationally so findings stay visible | Engineering productivity | Each weekly run | Informational |

## Rules

- An exception must name the exact gate and a specific reason.
- An exception that suppresses a security finding must record what makes the
  residual risk acceptable, and who accepted it.
- Every exception has an owner and a review date. An expired exception is a
  defect.
- Deleting or loosening a test, or widening a lint/security suppression, is
  **not** an acceptable exception. Fix the cause or record a genuine,
  scoped exception here.

## Not exceptions

The following are deliberate design decisions, not gate exceptions, and are
recorded in `QUALITY_GATES.md` instead:

- No coverage-percentage threshold.
- No mutation testing.
- No DAST, SBOM, artifact signing, or progressive delivery (no environment or
  registry to attach them to).
