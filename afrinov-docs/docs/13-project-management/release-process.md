<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-13-008</b></td>
<td align="center"><b><i>Release Process</i></b><br><i>Project Management</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-13-008 updated=2026-11-27 by="Ntokozo Maselala" body=84e6a7ab6c8d -->

# Release Process

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Planned — no release process is implemented in the repository** (no
deploy jobs, no staging environment, no release tags). Since 2026-11-27 there
is a [`CHANGELOG.md`](../../../CHANGELOG.md) at the repository root, with an
*Unreleased* section.
Intent: deploy to staging automatically on merge; run the full
E2E/acceptance suite; manually review any change to inventory
transaction/balance logic before promoting to production; release during a
low-activity window until confidence is established, since the shop floor
depends on the system during working hours.

Go-live itself is planned in `workbook-replacement-roadmap.md` (repository
root, "Cutover and go-live").

## Until then: what a release should be

Recommended by the production readiness review (2026-11-27), not yet practised.
Each step uses something that exists today:

1. A commit on `main` with every CI workflow green.
2. `docs/engineering/PRODUCTION_READINESS_ASSESSMENT.md` current for that commit,
   and nothing it lists as blocking left open.
3. The *Unreleased* entries in `CHANGELOG.md` moved under the version and date.
4. An annotated tag on that commit (`git tag -a vX.Y.Z`), so the server installs
   a name rather than a hash (`deployment.md`, "Installing a new version").
5. A backup before the install, and the way back written down: an older version
   across a database change means restoring that backup (`deployment.md`;
   `backup-and-recovery.md`, "Restoring in earnest").
6. After the install, the checks in `deployment.md` Part 4 (health, readiness,
   ports) and a sign-in.

## Evidence
- `.github/workflows/` — CI only
- `git tag` — no tags at 4e6d76f; none at `71395dc` (2026-11-27)
- `afrinov-docs/docs/12-operations/deployment.md` — install, upgrade and recovery steps
