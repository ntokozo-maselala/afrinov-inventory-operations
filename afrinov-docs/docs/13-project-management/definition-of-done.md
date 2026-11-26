<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-13-003</b></td>
<td align="center"><b><i>Definition of Done</i></b><br><i>Project Management</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-13-003 updated=2026-11-26 by="Ntokozo Maselala" body=8542fcfa0c73 -->

# Definition of Done

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Code merged; automated tests passing at all applicable layers
(`11-testing/test-pyramid.md`); the corresponding row in
`11-testing/test-traceability.md` updated; documentation (`08-api`,
`09-frontend/page-inventory.md`) updated if the change affects them; no
new direct writes to derived/balance data introduced.

*Unverified:* whether this definition is applied in practice is not recorded
in the repository. What CI does enforce on every pull request: typecheck,
lint, unit tests, build, and backend integration tests
(`12-operations/ci-cd.md`). Documentation updates are not checked
automatically.
