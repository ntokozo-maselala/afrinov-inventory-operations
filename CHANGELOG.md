<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-GEN-010</b></td>
<td align="center"><b><i>Changelog</i></b><br><i>General</i></td>
<td align="center"><sub>Last updated</sub><br><b>27/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-GEN-010 updated=2026-11-27 by="Ntokozo Maselala" body=cf98d4adf80e -->

# Changelog

**Status:** DRAFT · **Owner:** Product/Engineering

What changes from one release of the platform to the next, newest first, for the
people who install it and the people who use it. Nothing has been released yet:
the workspaces are at version `0.1.0` and there is no release tag. This log starts
with the production readiness review of 2026-11-27; earlier changes are in the
merged pull requests on GitHub and in `git log`. How a release is made is in
[`release-process.md`](afrinov-docs/docs/13-project-management/release-process.md).

## Unreleased

### Fixed

- A list or report asked for with a `?category=` or `?type=` value it doesn't know
  now answers **400** ("category must be one of …", "type must be one of …")
  instead of **500**. One exception, as before: a Movements report
  (`/inventory-transactions?report=…`) sets the type itself and ignores
  `?type=`, unknown values included. Affects
  `/materials`, `/locations`, `/inventory-transactions` (and its summary and
  export), and the current-stock, movement-history, stock-status, consumption
  (and export) and re-order list export reports. Real values and an empty value
  list as before (TD-029).
- Tidying a supplier's website no longer takes time that grows with the square of
  its length; the import reports keep a value ending in `\` inside its table cell
  (SEC-08, four CodeQL alerts).

### Changed

- `docker-compose.yml` publishes the database and the API on `127.0.0.1` only, as
  the production overlay already did. A developer stack is no longer reachable
  from other machines; use an SSH tunnel. Running containers keep their old ports
  until they are recreated (SEC-03, in part).
- Backend and Frontend CI run on every pull request, skipping their jobs (as a
  pass) when the pull request touches none of their paths, and their jobs are
  named `Backend: …` / `Frontend: …`. `main` is protected and requires all eleven
  CI checks, so nothing merges with failing tests, a migration that drifts or a
  newly introduced secret (GATE-02, PRs #220 and #221). The secret scan's
  baseline still allows the one known password in history, which has to be
  rotated (SEC-07).

### Documentation

- New: the production readiness assessment, its audit and the remediation plan
  (`docs/engineering/`, `docs/audits/system/`).
- Corrected: schema comments on how balances are written (TD-020); the
  orientation in `task_context.md` (TD-021); the registers and indexes.

### Tests

- `GET /audit` now has its own tests (TD-023), and each fix above has a regression
  test that fails on the code before it.
