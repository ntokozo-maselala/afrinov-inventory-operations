<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-13-007</b></td>
<td align="center"><b><i>Pull Request Guidelines</i></b><br><i>Project Management</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-13-007 updated=2026-11-26 by="Ntokozo Maselala" body=793ae0bb0044 -->

# Pull Request Guidelines

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Each PR references the Functional Requirement(s) it implements, includes
tests (see `11-testing/test-traceability.md`), and — for anything touching
inventory balance logic — includes at least one test asserting the
"balance equals sum of transactions" invariant. Architecture-affecting PRs
link to or add an ADR in `00-governance/decision-log.md`.

*Unverified* as current practice. Integration tests that assert the
balance-equals-ledger invariant exist (`11-testing/integration-testing.md`);
pull requests and branch names do not cite FR IDs (`branching-strategy.md`).
